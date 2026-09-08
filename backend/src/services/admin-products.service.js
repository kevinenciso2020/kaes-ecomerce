import { prisma } from '../config/prisma.js'
import cloudinary from '../config/cloudinary.js'
import { generateSlug } from '../utils/slug.utils.js'
import { verifyMagicNumbers, cleanupTempFiles } from '../middleware/upload.middleware.js'
import { logger } from '../config/logger.js'

const log = logger.child({ component: 'admin-products' })

/**
 * Build a Prisma `where` clause for filtering products in the admin list.
 * All params are already validated by the route validators.
 */
const buildListWhere = ({ search, category, isActive, lowStock }) => {
  const where = {}
  if (search) {
    where.OR = [
      { name:        { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (category) where.category = { slug: category }
  if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true

  // lowStock: usamos un threshold fijo (5) como filtro SQL rápido en la lista.
  // El listado detallado de variantes bajas se hace vía /admin/products/low-stock
  // que sí respeta el threshold por variante.
  if (lowStock === 'true' || lowStock === true) {
    where.variants = {
      some: { stock: { lte: 5 } },
    }
  }

  return where
}

export const listProducts = async ({ page = 1, limit = 20, ...filters } = {}) => {
  const where = buildListWhere(filters)
  const skip  = (page - 1) * limit

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        category:      { select: { id: true, name: true, slug: true } },
        images:        { where: { isMain: true }, take: 1 },
        availableSizes: { include: { size: true } },
        _count:        { select: { variants: true, images: true } },
        variants: {
          select: { stock: true, lowStockThreshold: true },
        },
      },
    }),
    prisma.product.count({ where }),
  ])

  // Para cada producto computar totalStock y si tiene variantes con stock bajo.
  const enriched = products.map((p) => {
    const totalStock = p.variants.reduce((sum, v) => sum + v.stock, 0)
    const lowStockCount = p.variants.filter(
      (v) => v.stock <= (v.lowStockThreshold ?? p.lowStockThreshold),
    ).length
    return {
      ...p,
      totalStock,
      lowStockCount,
      variants: undefined,
    }
  })

  return {
    products: enriched,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / limit),
  }
}

export const getProductById = async (id) => {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category:       true,
      images:         { orderBy: { order: 'asc' } },
      variants:       { orderBy: [{ color: 'asc' }, { size: 'asc' }] },
      availableSizes: { include: { size: true } },
      discounts:      { where: { discount: { isActive: true } }, include: { discount: true } },
    },
  })
  if (!product) {
    const err = new Error('Producto no encontrado')
    err.status = 404
    throw err
  }
  return product
}

export const listLowStock = async ({ limit = 20 } = {}) => {
  // Devuelve productos que tienen al menos una variante con stock <= threshold,
  // junto con el detalle de qué variantes están bajas.
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      variants: {
        some: {
          stock: { lte: 5 }, // crude — refinamos en JS con el threshold real
        },
      },
    },
    include: {
      category: { select: { name: true, slug: true } },
      images:   { where: { isMain: true }, take: 1 },
      variants: {
        where: { stock: { lte: 5 } },
        orderBy: [{ size: 'asc' }, { color: 'asc' }],
      },
    },
    take: Number(limit),
  })

  return products
    .map((p) => ({
      ...p,
      lowStockVariants: p.variants.filter(
        (v) => v.stock <= (v.lowStockThreshold ?? p.lowStockThreshold ?? 5),
      ),
    }))
    .filter((p) => p.lowStockVariants.length > 0)
}

/**
 * Crea un producto con sus imágenes (multipart) y variantes.
 * Acepta:
 *   - files[] vía multer (subida directa a Cloudinary)
 *   - variants: JSON string con [{ size, color, colorHex?, stock, sku?, lowStockThreshold? }]
 *   - sizeIds: JSON string con [string] — IDs de Size que aplican al producto
 *   - rest: campos escalares (name, description, price, stock, categoryId|categorySlug, isFeatured, isActive)
 */
export const createProduct = async (data, files = []) => {
  const slug = generateSlug(data.name)
  const existing = await prisma.product.findUnique({ where: { slug } })
  if (existing) {
    const err = new Error('Ya existe un producto con ese nombre')
    err.status = 409
    throw err
  }

  // Resolver category
  let categoryId = data.categoryId
  if (!categoryId && data.categorySlug) {
    const cat = await prisma.category.findUnique({ where: { slug: data.categorySlug } })
    if (cat) categoryId = cat.id
  }
  if (!categoryId) {
    const err = new Error('La categoría es requerida')
    err.status = 400
    throw err
  }

  // Parsear variants
  let variants = []
  if (data.variants) {
    try {
      variants = typeof data.variants === 'string' ? JSON.parse(data.variants) : data.variants
      if (!Array.isArray(variants)) throw new Error('variants debe ser array')
    } catch (e) {
      const err = new Error(`variants inválido: ${e.message}`)
      err.status = 400
      throw err
    }
  }

  // Parsear sizeIds
  let sizeIds = []
  if (data.sizeIds) {
    try {
      sizeIds = typeof data.sizeIds === 'string' ? JSON.parse(data.sizeIds) : data.sizeIds
      if (!Array.isArray(sizeIds)) throw new Error('sizeIds debe ser array')
    } catch (e) {
      const err = new Error(`sizeIds inválido: ${e.message}`)
      err.status = 400
      throw err
    }
  }

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name:               data.name,
        slug,
        description:        data.description || '',
        price:              parseFloat(data.price),
        stock:              parseInt(data.stock) || 0,
        lowStockThreshold:  data.lowStockThreshold !== undefined ? parseInt(data.lowStockThreshold) : 5,
        isFeatured:         data.isFeatured === 'true' || data.isFeatured === true,
        isActive:           data.isActive === undefined ? true : data.isActive === 'true' || data.isActive === true,
        categoryId,
        variants: variants.length > 0 ? {
          create: variants.map((v) => ({
            size:               v.size || null,
            color:              v.color || null,
            colorHex:           v.colorHex || null,
            sku:                v.sku || null,
            stock:              parseInt(v.stock) || 0,
            lowStockThreshold:  v.lowStockThreshold !== undefined ? parseInt(v.lowStockThreshold) : null,
            price:              v.price !== undefined && v.price !== null ? parseFloat(v.price) : null,
          })),
        } : undefined,
        availableSizes: sizeIds.length > 0 ? {
          create: sizeIds.map((sizeId) => ({ sizeId })),
        } : undefined,
      },
      include: {
        variants: true,
        availableSizes: true,
      },
    })

    // Subir imágenes a Cloudinary si hay
    if (files && files.length > 0) {
      await verifyMagicNumbers(files)
      try {
        const uploaded = await Promise.all(
          files.map((file, idx) =>
            cloudinary.uploader.upload(file.path, {
              folder: 'ecommerce-ropa/products',
              transformation: [{ width: 1200, height: 1500, crop: 'fill', quality: 'auto' }],
            }).then((r) => ({
              url:      r.secure_url,
              publicId: r.public_id,
              isMain:   idx === 0,
              order:    idx,
            }))
          )
        )

        await tx.productImage.createMany({
          data: uploaded.map((u) => ({ ...u, productId: created.id })),
        })
      } finally {
        await cleanupTempFiles(files)
      }
    }

    return created
  })

  return getProductById(product.id)
}

export const updateProduct = async (id, data, files = []) => {
  const existing = await prisma.product.findUnique({ where: { id } })
  if (!existing) {
    const err = new Error('Producto no encontrado')
    err.status = 404
    throw err
  }

  // Resolver category si viene
  let categoryId
  if (data.categoryId) categoryId = data.categoryId
  else if (data.categorySlug) {
    const cat = await prisma.category.findUnique({ where: { slug: data.categorySlug } })
    if (cat) categoryId = cat.id
  }

  const updateData = {}
  if (data.name)               { updateData.name = data.name; updateData.slug = generateSlug(data.name) }
  if (data.description !== undefined) updateData.description = data.description
  if (data.price !== undefined)        updateData.price = parseFloat(data.price)
  if (data.stock !== undefined)        updateData.stock = parseInt(data.stock)
  if (data.lowStockThreshold !== undefined) updateData.lowStockThreshold = parseInt(data.lowStockThreshold)
  if (data.isFeatured !== undefined)   updateData.isFeatured = data.isFeatured === 'true' || data.isFeatured === true
  if (data.isActive !== undefined)     updateData.isActive   = data.isActive === 'true'   || data.isActive === true
  if (categoryId) updateData.categoryId = categoryId

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: updateData })

    // Reemplazar variants si vienen (estrategia: borrar todo y recrear — el admin
    // ya envió la matriz completa). Más simple que diff y evita conflictos de unique.
    if (data.variants !== undefined) {
      let variants = []
      try {
        variants = typeof data.variants === 'string' ? JSON.parse(data.variants) : data.variants
      } catch {
        const err = new Error('variants inválido')
        err.status = 400
        throw err
      }
      // Bloquear la actualización si hay variantes que tienen OrderItems vivos
      // (borrar variantes rompería integridad histórica).
      const variantIds = (await tx.productVariant.findMany({ where: { productId: id }, select: { id: true } })).map((v) => v.id)
      if (variantIds.length > 0) {
        const linked = await tx.orderItem.count({ where: { variantId: { in: variantIds } } })
        if (linked > 0) {
          const err = new Error(
            `No se pueden reemplazar las variantes: hay ${linked} ítems de pedido vinculados. Edita stock/SKU individualmente o agrega nuevas variantes.`,
          )
          err.status = 409
          throw err
        }
      }
      await tx.productVariant.deleteMany({ where: { productId: id } })
      if (Array.isArray(variants) && variants.length > 0) {
        await tx.productVariant.createMany({
          data: variants.map((v) => ({
            productId:          id,
            size:               v.size || null,
            color:              v.color || null,
            colorHex:           v.colorHex || null,
            sku:                v.sku || null,
            stock:              parseInt(v.stock) || 0,
            lowStockThreshold:  v.lowStockThreshold !== undefined ? parseInt(v.lowStockThreshold) : null,
            price:              v.price !== undefined && v.price !== null ? parseFloat(v.price) : null,
          })),
        })
      }
    }

    // Reemplazar sizeIds si vienen
    if (data.sizeIds !== undefined) {
      let sizeIds = []
      try {
        sizeIds = typeof data.sizeIds === 'string' ? JSON.parse(data.sizeIds) : data.sizeIds
      } catch {
        const err = new Error('sizeIds inválido')
        err.status = 400
        throw err
      }
      await tx.productAvailableSize.deleteMany({ where: { productId: id } })
      if (Array.isArray(sizeIds) && sizeIds.length > 0) {
        await tx.productAvailableSize.createMany({
          data: sizeIds.map((sizeId) => ({ productId: id, sizeId })),
        })
      }
    }

    // Subir nuevas imágenes si hay
    if (files && files.length > 0) {
      await verifyMagicNumbers(files)
      try {
        const currentMaxOrder = (await tx.productImage.findFirst({
          where: { productId: id },
          orderBy: { order: 'desc' },
          select: { order: true },
        }))?.order ?? -1

        const uploaded = await Promise.all(
          files.map((file, idx) =>
            cloudinary.uploader.upload(file.path, {
              folder: 'ecommerce-ropa/products',
              transformation: [{ width: 1200, height: 1500, crop: 'fill', quality: 'auto' }],
            }).then((r) => ({
              url:      r.secure_url,
              publicId: r.public_id,
              isMain:   false,
              order:    currentMaxOrder + idx + 1,
            }))
          )
        )

        await tx.productImage.createMany({
          data: uploaded.map((u) => ({ ...u, productId: id })),
        })
      } finally {
        await cleanupTempFiles(files)
      }
    }
  })

  return getProductById(id)
}

export const deleteProduct = async (id) => {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { images: true },
  })
  if (!product) {
    const err = new Error('Producto no encontrado')
    err.status = 404
    throw err
  }

  // Borrar imágenes de Cloudinary
  if (product.images.length > 0) {
    await Promise.allSettled(
      product.images
        .filter((img) => img.publicId)
        .map((img) => cloudinary.uploader.destroy(img.publicId)),
    )
  }

  // Soft delete
  await prisma.product.update({ where: { id }, data: { isActive: false } })

  return { id, softDeleted: true }
}

/**
 * Elimina UNA imagen del producto y la borra de Cloudinary.
 */
export const deleteProductImage = async (productId, imageId) => {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
  })
  if (!image) {
    const err = new Error('Imagen no encontrada')
    err.status = 404
    throw err
  }

  if (image.publicId) {
    try {
      await cloudinary.uploader.destroy(image.publicId)
    } catch (e) {
      log.warn({ err: e.message, publicId: image.publicId }, 'cloudinary.destroy_failed')
    }
  }

  await prisma.productImage.delete({ where: { id: imageId } })

  // Si era la imagen principal, marcar la siguiente como principal
  if (image.isMain) {
    const next = await prisma.productImage.findFirst({
      where: { productId },
      orderBy: { order: 'asc' },
    })
    if (next) {
      await prisma.productImage.update({
        where: { id: next.id },
        data: { isMain: true },
      })
    }
  }

  return { deleted: true, imageId }
}

/**
 * Marca una imagen como principal (desmarca las demás del mismo producto).
 */
export const setMainImage = async (productId, imageId) => {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
  })
  if (!image) {
    const err = new Error('Imagen no encontrada')
    err.status = 404
    throw err
  }

  await prisma.$transaction([
    prisma.productImage.updateMany({
      where: { productId },
      data: { isMain: false },
    }),
    prisma.productImage.update({
      where: { id: imageId },
      data: { isMain: true },
    }),
  ])

  return getProductById(productId)
}

/**
 * Reemplazo masivo de variantes para el endpoint PATCH /admin/products/:id/variants.
 * Es la versión "delta" (no requiere mandar todas las variantes).
 * body: { variants: [{ size, color, colorHex?, sku?, stock, lowStockThreshold?, price? }] }
 * Estrategia:
 *  - Si (size,color) ya existe → actualizar stock/sku/hex/threshold/price
 *  - Si no existe → crear
 *  - Variantes existentes que NO estén en el body → borrar (sólo si no tienen OrderItems)
 */
export const upsertVariants = async (productId, variantsInput) => {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) {
    const err = new Error('Producto no encontrado')
    err.status = 404
    throw err
  }

  let variants = []
  try {
    variants = typeof variantsInput === 'string' ? JSON.parse(variantsInput) : variantsInput
    if (!Array.isArray(variants)) throw new Error('variants debe ser array')
  } catch (e) {
    const err = new Error(`variants inválido: ${e.message}`)
    err.status = 400
    throw err
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.productVariant.findMany({
      where: { productId },
      include: { _count: { select: { orderItems: true } } },
    })

    const incomingKeys = new Set(
      variants.map((v) => `${v.size ?? ''}::${v.color ?? ''}`),
    )

    // Borrar las que ya no vienen — sólo si no tienen OrderItems
    for (const ex of existing) {
      const key = `${ex.size ?? ''}::${ex.color ?? ''}`
      if (!incomingKeys.has(key)) {
        if (ex._count.orderItems > 0) {
          const err = new Error(
            `No se puede borrar la variante ${ex.color}/${ex.size}: tiene ${ex._count.orderItems} pedido(s) vinculado(s).`,
          )
          err.status = 409
          throw err
        }
        await tx.productVariant.delete({ where: { id: ex.id } })
      }
    }

    // Upsert las que vienen
    for (const v of variants) {
      const data = {
        size:              v.size || null,
        color:             v.color || null,
        colorHex:          v.colorHex || null,
        sku:               v.sku || null,
        stock:             parseInt(v.stock) || 0,
        lowStockThreshold: v.lowStockThreshold !== undefined ? parseInt(v.lowStockThreshold) : null,
        price:             v.price !== undefined && v.price !== null ? parseFloat(v.price) : null,
      }
      if (v.size || v.color) {
        await tx.productVariant.upsert({
          where: { productId_size_color: { productId, size: v.size || null, color: v.color || null } },
          update: data,
          create: { ...data, productId },
        })
      } else {
        // Variante "huérfana" (sin size ni color) — no se puede upsertar por unique,
        // crear nueva
        await tx.productVariant.create({ data: { ...data, productId } })
      }
    }

    return getProductById(productId)
  })
}
