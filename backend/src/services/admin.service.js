import { prisma } from '../config/prisma.js'

export const getAllUsers = async ({ page = 1, limit = 20, search, role }) => {
  const where = { isActive: true }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (role) where.role = role

  const skip = (page - 1) * limit
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: Number(limit),
      select: {
        id: true, name: true, email: true, role: true, avatar: true, phone: true,
        isActive: true, createdAt: true,
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ])

  return { users, total, page: Number(page), totalPages: Math.ceil(total / limit) }
}

export const getUserById = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, role: true, avatar: true, phone: true,
      isActive: true, createdAt: true, updatedAt: true,
      orders: {
        select: { id: true, status: true, total: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      addresses: {
        select: { id: true, label: true, street: true, city: true },
      },
    },
  })

  if (!user) {
    const err = new Error('Usuario no encontrado')
    err.status = 404
    throw err
  }

  return user
}

export const updateUser = async (id, data) => {
  try {
    return await prisma.user.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.isActive !== undefined && { isActive: Boolean(data.isActive) }),
      },
      select: {
        id: true, name: true, email: true, role: true, avatar: true, phone: true,
        isActive: true, createdAt: true, updatedAt: true,
      },
    })
  } catch (e) {
    if (e.code === 'P2025') {
      const err = new Error('Usuario no encontrado')
      err.status = 404
      throw err
    }
    throw e
  }
}

export const deleteUser = async (id, { hard = false } = {}) => {
  if (hard) {
    try {
      return await prisma.user.delete({
        where: { id },
        select: { id: true, name: true, email: true, role: true },
      })
    } catch (e) {
      if (e.code === 'P2025') {
        const err = new Error('Usuario no encontrado')
        err.status = 404
        throw err
      }
      if (e.code === 'P2003') {
        const err = new Error(
          'No se puede eliminar definitivamente: el usuario tiene órdenes, direcciones o registros asociados. Desactívelo en su lugar.',
        )
        err.status = 409
        throw err
      }
      throw e
    }
  }

  try {
    return await prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
      },
    })
  } catch (e) {
    if (e.code === 'P2025') {
      const err = new Error('Usuario no encontrado')
      err.status = 404
      throw err
    }
    throw e
  }
}

export const updateUserRole = async (id, role) => {
  try {
    return await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true, name: true, email: true, role: true,
      },
    })
  } catch (e) {
    if (e.code === 'P2025') {
      const err = new Error('Usuario no encontrado')
      err.status = 404
      throw err
    }
    throw e
  }
}

export const getAllOrders = async ({ page = 1, limit = 20, status }) => {
  const where = status ? { status } : {}
  const skip  = (page - 1) * limit

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take:    Number(limit),
      include: { user: { select: { name: true, email: true } }, payment: true },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.order.count({ where })
  ])

  return { orders, total, page: Number(page), totalPages: Math.ceil(total / limit) }
}

import { restoreStock } from './stock.service.js'

export const updateOrderStatus = async (orderId, status) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } })
  
  if (!order) {
    throw Object.assign(new Error('Orden no encontrada'), { status: 404 })
  }

  const wasPendingOrConfirmed = order.status === 'PENDING' || order.status === 'CONFIRMED'
  const isNowCancelled = status === 'CANCELLED'

  if (wasPendingOrConfirmed && isNowCancelled) {
    await restoreStock(orderId)
  }

  return prisma.order.update({ where: { id: orderId }, data: { status } })
}

export const createDiscount = async ({ name, type, value, startsAt, endsAt, productIds }) => {
  const discount = await prisma.discount.create({
    data: {
      name,
      type,
      value:    parseFloat(value),
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt:   endsAt   ? new Date(endsAt)   : null,
    }
  })

  // Asociar el descuento a los productos seleccionados
  if (productIds && productIds.length > 0) {
    await prisma.productDiscount.createMany({
      data: productIds.map(productId => ({ productId, discountId: discount.id }))
    })
  }

  return discount
}

export const createCoupon = async (data) => {
  return prisma.coupon.create({
    data: {
      code:        data.code.toUpperCase(),
      type:        data.type,
      value:       parseFloat(data.value),
      minPurchase: data.minPurchase ? parseFloat(data.minPurchase) : null,
      maxUses:     data.maxUses     ? parseInt(data.maxUses)       : null,
      startsAt:    data.startsAt    ? new Date(data.startsAt)      : null,
      endsAt:      data.endsAt      ? new Date(data.endsAt)        : null,
    }
  })
}

export const getCoupons = async () => {
  return prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } })
}

export const updateCoupon = async (id, data) => {
  const updateData = {}
  if (data.code)        updateData.code        = data.code.toUpperCase()
  if (data.type)        updateData.type        = data.type
  if (data.value !== undefined) updateData.value = parseFloat(data.value)
  if (data.minPurchase !== undefined) updateData.minPurchase = data.minPurchase ? parseFloat(data.minPurchase) : null
  if (data.maxUses !== undefined)     updateData.maxUses     = data.maxUses ? parseInt(data.maxUses) : null
  if (data.startsAt !== undefined)    updateData.startsAt    = data.startsAt ? new Date(data.startsAt) : null
  if (data.endsAt !== undefined)      updateData.endsAt      = data.endsAt ? new Date(data.endsAt) : null
  if (data.isActive !== undefined)    updateData.isActive    = Boolean(data.isActive)

  try {
    return await prisma.coupon.update({
      where: { id },
      data: updateData,
    })
  } catch (e) {
    if (e.code === 'P2025') {
      const err = new Error('Cupón no encontrado')
      err.status = 404
      throw err
    }
    if (e.code === 'P2002') {
      const err = new Error('Ya existe un cupón con ese código')
      err.status = 409
      throw err
    }
    throw e
  }
}

export const getDiscounts = async () => {
  return prisma.discount.findMany({
    include: { products: { include: { product: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' }
  })
}

export const getAllProducts = async ({ page = 1, limit = 20, search, category, isActive }) => {
  const where = {}
  if (search) where.name = { contains: search, mode: 'insensitive' }
  if (category) where.category = { slug: category }
  if (isActive !== undefined) where.isActive = isActive === 'true'

  const skip = (page - 1) * limit
  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take:    Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { name: true, slug: true } },
        images:   { where: { isMain: true }, take: 1 },
        variants: { select: { size: true, color: true, stock: true } }
      }
    }),
    prisma.product.count({ where })
  ])

  return { products, total, page: Number(page), totalPages: Math.ceil(total / limit) }
}

export const getDashboardStats = async () => {
  const [totalUsers, totalProducts, totalOrders, revenue] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.order.count(),
    prisma.order.aggregate({
      _sum:   { total: true },
      where:  { status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } }
    })
  ])

  return {
    totalUsers,
    totalProducts,
    totalOrders,
    revenue: revenue._sum.total || 0,
  }
}