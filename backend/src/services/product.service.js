import { prisma } from '../config/prisma.js'
import { generateSlug } from '../utils/slug.utils.js'
import cloudinary from '../config/cloudinary.js'
import { verifyMagicNumbers, cleanupTempFiles } from '../middleware/upload.middleware.js'

export const getProducts = async ({ page = 1, limit = 12, category, minPrice, maxPrice, size, color, search, featured }) => {
  const skip = (page - 1) * limit

  // Construimos el filtro dinámicamente según los parámetros recibidos
  const where = { isActive: true }

  if (category)           where.category  = { slug: category }
  if (featured === 'true') where.isFeatured = true
  if (search) {
    where.OR = [
      { name:        { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (minPrice || maxPrice) {
    where.price = {}
    if (minPrice) where.price.gte = parseFloat(minPrice)
    if (maxPrice) where.price.lte = parseFloat(maxPrice)
  }
  if (size || color) {
    where.variants = { some: {} }
    if (size)  where.variants.some.size  = size
    if (color) where.variants.some.color = color
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take:    Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { name: true, slug: true } },
        images:   { where: { isMain: true }, take: 1 },
        variants: { select: { size: true, color: true, stock: true } },
        discounts: {
          where: { discount: { isActive: true } },
          include: { discount: true }
        }
      }
    }),
    prisma.product.count({ where })
  ])

  return {
    products,
    pagination: {
      total,
      page:       Number(page),
      limit:      Number(limit),
      totalPages: Math.ceil(total / limit),
    }
  }
}

export const getProductBySlug = async (slug) => {
  const product = await prisma.product.findUnique({
    where:   { slug, isActive: true },
    include: {
      category: true,
      images:   { orderBy: { order: 'asc' } },
      variants: true,
      discounts: {
        where:   { discount: { isActive: true } },
        include: { discount: true }
      }
    }
  })

  if (!product) {
    const err = new Error('Producto no encontrado')
    err.status = 404
    throw err
  }

  return product
}

export const createProduct = async (data, files) => {
  const slug = generateSlug(data.name)

  const existing = await prisma.product.findUnique({ where: { slug } })
  if (existing) {
    const err = new Error('Ya existe un producto con ese nombre')
    err.status = 409
    throw err
  }

  let categoryId = data.categoryId
  if (!categoryId && data.categorySlug) {
    const category = await prisma.category.findUnique({ where: { slug: data.categorySlug } })
    if (category) categoryId = category.id
  }

  const product = await prisma.product.create({
    data: {
      name:        data.name,
      slug,
      description: data.description,
      price:       parseFloat(data.price),
      stock:       parseInt(data.stock) || 0,
      categoryId,
      isFeatured:  data.isFeatured === 'true',
    }
  })

  // Usar URLs de Cloudinary si se proporcionan
  let imageUrls = []
  if (data.imageUrls) {
    if (typeof data.imageUrls === 'string') {
      try { imageUrls = JSON.parse(data.imageUrls) } catch { imageUrls = [data.imageUrls] }
    } else if (Array.isArray(data.imageUrls)) {
      imageUrls = data.imageUrls
    }
  }

  // Usar URLs
  if (imageUrls.length > 0) {
    for (let i = 0; i < imageUrls.length; i++) {
      await prisma.productImage.create({
        data: {
          url:       imageUrls[i],
          publicId:  '',
          isMain:    i === 0,
          order:     i,
          productId: product.id,
        }
      })
    }
  }
  // O subir archivos a Cloudinary
  else if (files && files.length > 0) {
    try {
      await verifyMagicNumbers(files)
      const uploadPromises = files.map((file, index) =>
        cloudinary.uploader.upload(file.path, {
          folder:         'ecommerce-ropa/products',
          transformation: [{ width: 800, height: 1000, crop: 'fill', quality: 'auto' }]
        }).then(result =>
          prisma.productImage.create({
            data: {
              url:       result.secure_url,
              publicId:  result.public_id,
              isMain:    index === 0,
              order:     index,
              productId: product.id,
            }
          })
        )
      )
      await Promise.all(uploadPromises)
    } finally {
      await cleanupTempFiles(files)
    }
  }

  if (data.variants) {
    const variants = JSON.parse(data.variants)
    await prisma.productVariant.createMany({
      data: variants.map(v => ({ ...v, productId: product.id }))
    })
  } else if (data.colors && Array.isArray(data.colors)) {
    const colors = typeof data.colors === 'string' ? JSON.parse(data.colors) : data.colors
    await prisma.productVariant.createMany({
      data: colors.map(color => ({
        productId: product.id,
        color: color,
        stock: parseInt(data.stock) || 0
      }))
    })
  }

  return prisma.product.findUnique({
    where:   { id: product.id },
    include: { images: true, variants: true, category: true }
  })
}

export const updateProduct = async (id, data, files) => {
  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) {
    const err = new Error('Producto no encontrado')
    err.status = 404
    throw err
  }

  const updateData = {}
  if (data.name)        { updateData.name = data.name; updateData.slug = generateSlug(data.name) }
  if (data.description) updateData.description = data.description
  if (data.price)       updateData.price       = parseFloat(data.price)
  if (data.stock)       updateData.stock       = parseInt(data.stock)
  if (data.categoryId)  updateData.categoryId  = data.categoryId
  else if (data.categorySlug) {
    const category = await prisma.category.findUnique({ where: { slug: data.categorySlug } })
    if (category) updateData.categoryId = category.id
  }
  if (data.isActive !== undefined) updateData.isActive   = data.isActive === 'true'
  if (data.isFeatured !== undefined) updateData.isFeatured = data.isFeatured === 'true'

  await prisma.product.update({ where: { id }, data: updateData })

  // Usar URLs de Cloudinary si se proporcionan
  let imageUrls = []
  if (data.imageUrls) {
    if (typeof data.imageUrls === 'string') {
      try { imageUrls = JSON.parse(data.imageUrls) } catch { imageUrls = [data.imageUrls] }
    } else if (Array.isArray(data.imageUrls)) {
      imageUrls = data.imageUrls
    }
  }

  // Guardar URLs directamente
  if (imageUrls.length > 0) {
    for (let i = 0; i < imageUrls.length; i++) {
      await prisma.productImage.create({
        data: {
          url:       imageUrls[i],
          publicId:  '',
          isMain:    false,
          order:    i,
          productId: id,
        }
      })
    }
  }
  // O subir archivos a Cloudinary
  else if (files && files.length > 0) {
    try {
      await verifyMagicNumbers(files)
      const uploadPromises = files.map((file, index) =>
        cloudinary.uploader.upload(file.path, {
          folder:         'ecommerce-ropa/products',
          transformation: [{ width: 800, height: 1000, crop: 'fill', quality: 'auto' }]
        }).then(result =>
          prisma.productImage.create({
            data: {
              url:       result.secure_url,
              publicId:  result.public_id,
              isMain:    false,
              order:     index,
              productId: id,
            }
          })
        )
      )
      await Promise.all(uploadPromises)
    } finally {
      await cleanupTempFiles(files)
    }
  }

  // Actualizar variants/colores si se proporcionan
  if (data.colors && Array.isArray(data.colors)) {
    const colors = typeof data.colors === 'string' ? JSON.parse(data.colors) : data.colors
    await prisma.productVariant.deleteMany({ where: { productId: id } })
    await prisma.productVariant.createMany({
      data: colors.map(color => ({
        productId: id,
        color: color,
        stock: parseInt(data.stock) || product.stock
      }))
    })
  }

  return prisma.product.findUnique({
    where:   { id },
    include: { images: true, variants: true, category: true }
  })
}

export const deleteProduct = async (id) => {
  const product = await prisma.product.findUnique({
    where:   { id },
    include: { images: true }
  })

  if (!product) {
    const err = new Error('Producto no encontrado')
    err.status = 404
    throw err
  }

  // Eliminar imágenes de Cloudinary antes de borrar el producto
  if (product.images.length > 0) {
    await Promise.all(
      product.images
        .filter(img => img.publicId)
        .map(img => cloudinary.uploader.destroy(img.publicId))
    )
  }

  // Soft delete — desactivar en vez de borrar para no romper órdenes históricas
  await prisma.product.update({ where: { id }, data: { isActive: false } })

  return { message: 'Producto eliminado correctamente' }
}

export const getCategories = async () => {
  return prisma.category.findMany({ orderBy: { name: 'asc' } })
}

export const createCategory = async ({ name, description }) => {
  const slug = generateSlug(name)
  return prisma.category.create({ data: { name, slug, description } })
}