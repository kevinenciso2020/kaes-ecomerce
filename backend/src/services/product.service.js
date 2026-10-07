import { prisma } from '../config/prisma.js'
import { applyProductDiscounts } from './pricing.service.js'

// Precio final con el mejor descuento de producto vigente (el mismo cálculo
// que se usa al crear la orden).
const withFinalPrice = (product) => ({
  ...product,
  finalPrice: applyProductDiscounts(parseFloat(product.price), product.discounts || []),
})

export const getProducts = async ({ page = 1, limit = 12, category, minPrice, maxPrice, size, color, search, featured }) => {
  page = Math.max(1, Number.parseInt(page, 10) || 1)
  limit = Math.min(48, Math.max(1, Number.parseInt(limit, 10) || 12))
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
    products: products.map(withFinalPrice),
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

  return withFinalPrice(product)
}

export const getCategories = async () => {
  return prisma.category.findMany({ orderBy: { name: 'asc' } })
}
