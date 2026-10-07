import { prisma } from '../config/prisma.js'
import { generateSlug } from '../utils/slug.utils.js'
import { cleanupTempFiles } from '../middleware/upload.middleware.js'
import { parseImageUrls, importRemoteImages, uploadProductFiles, destroyImages } from '../utils/cloudinary.utils.js'
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
    const low = [
      { variants: { some: { stock: { lte: 5 } } } },
      { variants: { none: {} }, stock: { lte: 5 } },
    ]
    where.AND = [...(where.AND || []), { OR: low }]
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
    // Con variantes el stock real es la suma de variantes; sin variantes es el del producto.
    const hasVariants = p.variants.length > 0
    const totalStock = hasVariants ? p.variants.reduce((sum, v) => sum + v.stock, 0) : p.stock
    const lowStockCount = hasVariants
      ? p.variants.filter((v) => v.stock <= (v.lowStockThreshold ?? p.lowStockThreshold)).length
      : (p.stock <= p.lowStockThreshold ? 1 : 0)
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

const httpError = (status, message) => Object.assign(new Error(message), { status })

const parseJsonArray = (value, field) => {
  if (value === undefined || value === null || value === '') return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed)) throw new Error(`${field} debe ser array`)
    return parsed
  } catch (e) {
    throw httpError(400, `${field} inválido: ${e.message}`)
  }
}

const toBool = (v) => v === true || v === 'true'

const normalizeVariant = (v) => ({
  size:              v.size ? String(v.size).trim() : null,
  color:             v.color ? String(v.color).trim() : null,
  colorHex:          v.colorHex || null,
  sku:               v.sku ? String(v.sku).trim() : null,
  stock:             Math.max(0, parseInt(v.stock) || 0),
  lowStockThreshold: v.lowStockThreshold !== undefined && v.lowStockThreshold !== null && v.lowStockThreshold !== '' ? parseInt(v.lowStockThreshold) : null,
  price:             v.price !== undefined && v.price !== null && v.price !== '' ? parseFloat(v.price) : null,
})

/** Genera un slug libre: "camiseta", "camiseta-2", "camiseta-3"… */
const uniqueSlug = async (db, name, excludeId) => {
  const base = generateSlug(name) || 'producto'
  let candidate = base
  for (let i = 2; i < 200; i++) {
    const clash = await db.product.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!clash || clash.id === excludeId) return candidate
    candidate = `${base}-${i}`
  }
  return `${base}-${Date.now().toString(36)}`
}

const resolveCategoryId = async (data) => {
  if (data.categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: data.categoryId }, select: { id: true } })
    if (!cat) throw httpError(400, 'La categoría no existe')
    return cat.id
  }
  if (data.categorySlug) {
    const cat = await prisma.category.findUnique({ where: { slug: data.categorySlug }, select: { id: true } })
    if (!cat) throw httpError(400, 'La categoría no existe')
    return cat.id
  }
  return null
}

/**
 * Crea un producto con imágenes y variantes.
 * Acepta (multipart/form-data):
 *   - images[]: archivos JPG/PNG/WEBP (se suben a Cloudinary)
 *   - imageUrls: JSON o lista separada por comas/saltos de línea con URLs https (Cloudinary las descarga y aloja)
 *   - variants: JSON [{ size, color, colorHex?, stock, sku?, lowStockThreshold?, price? }]
 *   - sizeIds: JSON [id de Size]
 *   - name, description, price, stock, lowStockThreshold, categoryId|categorySlug, isFeatured, isActive
 */
export const createProduct = async (data, files = []) => {
  const categoryId = await resolveCategoryId(data)
  if (!categoryId) {
    await cleanupTempFiles(files)
    throw httpError(400, 'La categoría es requerida')
  }

  let variants, sizeIds, urlImages
  try {
    variants = parseJsonArray(data.variants, 'variants').map(normalizeVariant)
    sizeIds = parseJsonArray(data.sizeIds, 'sizeIds')
    urlImages = parseImageUrls(data.imageUrls)
  } catch (err) {
    await cleanupTempFiles(files)
    throw err
  }

  // 1) Subir archivos a Cloudinary ANTES de abrir la transacción.
  const uploaded = await uploadProductFiles(files)
  let imported
  try {
    imported = await importRemoteImages(urlImages)
  } catch (err) {
    await destroyImages(uploaded.map((u) => u.publicId))
    throw err
  }
  const images = [...uploaded, ...imported.images]

  try {
    const product = await prisma.$transaction(async (tx) => {
      const slug = await uniqueSlug(tx, data.name)
      return tx.product.create({
        data: {
          name:              data.name,
          slug,
          description:       data.description || '',
          price:             parseFloat(data.price),
          stock:             Math.max(0, parseInt(data.stock) || 0),
          lowStockThreshold: data.lowStockThreshold !== undefined && data.lowStockThreshold !== '' ? parseInt(data.lowStockThreshold) : 5,
          isFeatured:        toBool(data.isFeatured),
          isActive:          data.isActive === undefined ? true : toBool(data.isActive),
          categoryId,
          variants:       variants.length ? { create: variants } : undefined,
          availableSizes: sizeIds.length ? { create: sizeIds.map((sizeId) => ({ sizeId })) } : undefined,
          images: images.length
            ? { create: images.map((img, idx) => ({ url: img.url, publicId: img.publicId, isMain: idx === 0, order: idx, alt: data.name })) }
            : undefined,
        },
      })
    })
    log.info({ productId: product.id, images: images.length, variants: variants.length }, 'product.created')
    return getProductById(product.id)
  } catch (err) {
    // Si la BD falla, no dejar imágenes huérfanas en Cloudinary.
    await destroyImages([...uploaded.map((u) => u.publicId), ...imported.uploadedIds])
    throw err
  }
}

export const updateProduct = async (id, data, files = []) => {
  const existing = await prisma.product.findUnique({ where: { id } })
  if (!existing) {
    await cleanupTempFiles(files)
    throw httpError(404, 'Producto no encontrado')
  }

  let categoryId, variants, sizeIds, urlImages
  try {
    categoryId = await resolveCategoryId(data)
    variants = data.variants !== undefined ? parseJsonArray(data.variants, 'variants').map(normalizeVariant) : undefined
    sizeIds = data.sizeIds !== undefined ? parseJsonArray(data.sizeIds, 'sizeIds') : undefined
    urlImages = parseImageUrls(data.imageUrls)
  } catch (err) {
    await cleanupTempFiles(files)
    throw err
  }

  const uploaded = await uploadProductFiles(files)
  let imported
  try {
    imported = await importRemoteImages(urlImages)
  } catch (err) {
    await destroyImages(uploaded.map((u) => u.publicId))
    throw err
  }
  const newImages = [...uploaded, ...imported.images]

  try {
    await prisma.$transaction(async (tx) => {
      const updateData = {}
      if (data.name && data.name !== existing.name) {
        updateData.name = data.name
        updateData.slug = await uniqueSlug(tx, data.name, id)
      }
      if (data.description !== undefined)       updateData.description = data.description
      if (data.price !== undefined)             updateData.price = parseFloat(data.price)
      if (data.stock !== undefined)             updateData.stock = Math.max(0, parseInt(data.stock) || 0)
      if (data.lowStockThreshold !== undefined && data.lowStockThreshold !== '') updateData.lowStockThreshold = parseInt(data.lowStockThreshold)
      if (data.isFeatured !== undefined)        updateData.isFeatured = toBool(data.isFeatured)
      if (data.isActive !== undefined)          updateData.isActive = toBool(data.isActive)
      if (categoryId)                           updateData.categoryId = categoryId

      await tx.product.update({ where: { id }, data: updateData })

      if (variants !== undefined) await syncVariants(tx, id, variants)

      if (sizeIds !== undefined) {
        await tx.productAvailableSize.deleteMany({ where: { productId: id } })
        if (sizeIds.length) {
          await tx.productAvailableSize.createMany({ data: sizeIds.map((sizeId) => ({ productId: id, sizeId })) })
        }
      }

      if (newImages.length) {
        const agg = await tx.productImage.aggregate({ where: { productId: id }, _max: { order: true }, _count: true })
        const start = (agg._max.order ?? -1) + 1
        const hasImages = agg._count > 0
        await tx.productImage.createMany({
          data: newImages.map((img, idx) => ({
            productId: id, url: img.url, publicId: img.publicId, alt: data.name || existing.name,
            order: start + idx, isMain: !hasImages && idx === 0,
          })),
        })
      }
    })
  } catch (err) {
    await destroyImages([...uploaded.map((u) => u.publicId), ...imported.uploadedIds])
    throw err
  }

  return getProductById(id)
}

/**
 * Sincroniza variantes con la matriz enviada: actualiza las existentes por
 * (talla, color), crea las nuevas y borra las que ya no vienen — excepto las
 * que tienen pedidos vinculados (en ese caso sólo se deja su stock en 0 para
 * no romper el historial).
 */
const syncVariants = async (tx, productId, variants) => {
  const existing = await tx.productVariant.findMany({
    where: { productId },
    include: { _count: { select: { orderItems: true } } },
  })
  const key = (v) => `${v.size ?? ''}::${v.color ?? ''}`
  const incoming = new Map(variants.map((v) => [key(v), v]))

  for (const ex of existing) {
    const next = incoming.get(key(ex))
    if (next) {
      await tx.productVariant.update({ where: { id: ex.id }, data: next })
      incoming.delete(key(ex))
    } else if (ex._count.orderItems > 0) {
      await tx.productVariant.update({ where: { id: ex.id }, data: { stock: 0 } })
    } else {
      await tx.productVariant.delete({ where: { id: ex.id } })
    }
  }
  for (const v of incoming.values()) {
    await tx.productVariant.create({ data: { ...v, productId } })
  }
}

/** Agrega imágenes (archivos y/o URLs de Cloudinary) a un producto existente. */
export const addProductImages = async (id, { imageUrls } = {}, files = []) => {
  return updateProduct(id, { imageUrls }, files)
}

/**
 * Elimina un producto.
 *  - Por defecto lo ARCHIVA (isActive=false): deja de verse en la tienda pero
 *    conserva imágenes e historial (los pedidos antiguos lo siguen mostrando).
 *  - hard=true lo borra definitivamente junto con sus imágenes de Cloudinary,
 *    sólo si nunca se ha vendido.
 */
export const deleteProduct = async (id, { hard = false } = {}) => {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { images: true, _count: { select: { orderItems: true } } },
  })
  if (!product) throw httpError(404, 'Producto no encontrado')

  if (!hard) {
    await prisma.product.update({ where: { id }, data: { isActive: false } })
    log.info({ productId: id }, 'product.archived')
    return { id, archived: true }
  }

  if (product._count.orderItems > 0) {
    throw httpError(409, `No se puede eliminar definitivamente: tiene ${product._count.orderItems} venta(s) registradas. Archívalo en su lugar.`)
  }

  await prisma.$transaction([
    prisma.cartItem.deleteMany({ where: { productId: id } }),
    prisma.product.delete({ where: { id } }),
  ])
  await destroyImages(product.images.map((img) => img.publicId))
  log.info({ productId: id }, 'product.deleted')
  return { id, deleted: true }
}

/** Reactiva un producto archivado. */
export const restoreProduct = async (id) => {
  const product = await prisma.product.findUnique({ where: { id }, select: { id: true } })
  if (!product) throw httpError(404, 'Producto no encontrado')
  await prisma.product.update({ where: { id }, data: { isActive: true } })
  return getProductById(id)
}

/**
 * Elimina UNA imagen del producto y la borra de Cloudinary.
 */
export const deleteProductImage = async (productId, imageId) => {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
  })
  if (!image) throw httpError(404, 'Imagen no encontrada')

  await prisma.productImage.delete({ where: { id: imageId } })
  await destroyImages([image.publicId])

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
 * PATCH /admin/products/:id/variants — reemplaza la matriz de variantes.
 * Usa la misma sincronización que updateProduct (conserva variantes con
 * pedidos, dejando su stock en 0 si ya no vienen).
 */
export const upsertVariants = async (productId, variantsInput) => {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
  if (!product) throw httpError(404, 'Producto no encontrado')

  const variants = parseJsonArray(variantsInput, 'variants').map(normalizeVariant)
  await prisma.$transaction((tx) => syncVariants(tx, productId, variants))
  return getProductById(productId)
}
