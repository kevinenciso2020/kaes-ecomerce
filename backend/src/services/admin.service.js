import bcrypt from 'bcryptjs'
import { prisma } from '../config/prisma.js'

const httpError = (status, message) => Object.assign(new Error(message), { status })

const isAdminRole = (role) => role === 'ADMIN' || role === 'SUPER_ADMIN'

/**
 * Jerarquía: sólo un SUPER_ADMIN puede modificar/desactivar/eliminar a otro
 * ADMIN o SUPER_ADMIN, y nadie puede desactivarse o eliminarse a sí mismo.
 */
const loadTargetFor = async (actor, id, { selfAllowed = true } = {}) => {
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!target) throw httpError(404, 'Usuario no encontrado')
  if (!selfAllowed && actor?.id === id) throw httpError(400, 'No puedes realizar esta acción sobre tu propia cuenta')
  if (isAdminRole(target.role) && actor?.role !== 'SUPER_ADMIN' && actor?.id !== id) {
    throw httpError(403, 'Solo un SUPER_ADMIN puede modificar a otros administradores')
  }
  return target
}

const revokeSessions = (userId) => prisma.refreshToken.deleteMany({ where: { userId } })

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

export const updateUser = async (id, data, actor) => {
  const updated = await updateUserRecord(id, data, actor)
  if (!updated.isActive) await revokeSessions(id)
  return updated
}

const updateUserRecord = async (id, data, actor) => {
  const deactivating = data.isActive !== undefined && !(data.isActive === true || data.isActive === 'true')
  await loadTargetFor(actor, id, { selfAllowed: !deactivating })
  try {
    return await prisma.user.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.isActive !== undefined && { isActive: data.isActive === true || data.isActive === 'true' }),
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

export const deleteUser = async (id, { hard = false } = {}, actor) => {
  await loadTargetFor(actor, id, { selfAllowed: false })
  await revokeSessions(id)
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

export const updateUserRole = async (id, role, actor) => {
  if (actor?.id === id) throw httpError(400, 'No puedes cambiar tu propio rol')
  try {
    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true, name: true, email: true, role: true,
      },
    })
    // El rol viaja en el access token: se revocan las sesiones para que el
    // cambio aplique en el próximo refresh (máx. 15 min).
    await revokeSessions(id)
    return updated
  } catch (e) {
    if (e.code === 'P2025') {
      const err = new Error('Usuario no encontrado')
      err.status = 404
      throw err
    }
    throw e
  }
}

export const resetUserPassword = async (id, password) => {
  const hashedPassword = await bcrypt.hash(password, 12)
  try {
    const updated = await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
      select: {
        id: true, name: true, email: true, role: true,
      },
    })
    await revokeSessions(id)
    return updated
  } catch (e) {
    if (e.code === 'P2025') {
      const err = new Error('Usuario no encontrado')
      err.status = 404
      throw err
    }
    throw e
  }
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

export const updateDiscount = async (id, { name, type, value, startsAt, endsAt, isActive, productIds }) => {
  const existing = await prisma.discount.findUnique({ where: { id } })
  if (!existing) throw httpError(404, 'Descuento no encontrado')

  const data = {}
  if (name !== undefined)     data.name = name
  if (type !== undefined)     data.type = type
  if (value !== undefined)    data.value = parseFloat(value)
  if (startsAt !== undefined) data.startsAt = startsAt ? new Date(startsAt) : null
  if (endsAt !== undefined)   data.endsAt = endsAt ? new Date(endsAt) : null
  if (isActive !== undefined) data.isActive = isActive === true || isActive === 'true'

  const finalType = data.type ?? existing.type
  const finalValue = data.value ?? Number(existing.value)
  if (finalType === 'PERCENTAGE' && finalValue > 100) throw httpError(400, 'Un porcentaje no puede superar 100')

  return prisma.$transaction(async (tx) => {
    const discount = await tx.discount.update({ where: { id }, data })
    if (Array.isArray(productIds)) {
      await tx.productDiscount.deleteMany({ where: { discountId: id } })
      if (productIds.length) {
        await tx.productDiscount.createMany({
          data: productIds.map((productId) => ({ productId, discountId: id })),
          skipDuplicates: true,
        })
      }
    }
    return discount
  })
}

export const deleteDiscount = async (id) => {
  const existing = await prisma.discount.findUnique({ where: { id } })
  if (!existing) throw httpError(404, 'Descuento no encontrado')
  await prisma.$transaction([
    prisma.productDiscount.deleteMany({ where: { discountId: id } }),
    prisma.discount.delete({ where: { id } }),
  ])
  return { message: 'Descuento eliminado' }
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