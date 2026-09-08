import { prisma } from '../config/prisma.js'
import { restoreStock } from './stock.service.js'

const ORDER_INCLUDE = {
  user: {
    select: { id: true, name: true, email: true, phone: true },
  },
  items: {
    include: {
      product: {
        select: {
          id: true, name: true, slug: true,
          images: { where: { isMain: true }, take: 1 },
        },
      },
      variant: true,
    },
  },
  payment: true,
  shippingAddress: true,
  statusLogs: {
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { select: { id: true, name: true, email: true, role: true } } },
  },
}

const buildListWhere = ({ status, userId, dateFrom, dateTo, search }) => {
  const where = {}
  if (status) where.status = status
  if (userId) where.userId = userId

  if (dateFrom || dateTo) {
    where.createdAt = {}
    if (dateFrom) where.createdAt.gte = new Date(dateFrom)
    if (dateTo)   where.createdAt.lte = new Date(dateTo)
  }

  if (search) {
    where.OR = [
      { id: { contains: search, mode: 'insensitive' } },
      { user: { name:  { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
      { notes: { contains: search, mode: 'insensitive' } },
    ]
  }

  return where
}

export const listOrders = async ({
  page = 1,
  limit = 20,
  status,
  userId,
  dateFrom,
  dateTo,
  search,
} = {}) => {
  const where = buildListWhere({ status, userId, dateFrom, dateTo, search })
  const skip  = (page - 1) * limit

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take: Number(limit),
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.order.count({ where }),
  ])

  return {
    orders,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / limit),
  }
}

export const getOrderById = async (id) => {
  const order = await prisma.order.findUnique({
    where: { id },
    include: ORDER_INCLUDE,
  })
  if (!order) {
    const err = new Error('Orden no encontrada')
    err.status = 404
    throw err
  }
  return order
}

/**
 * Cambia el estado de una orden y registra el cambio en OrderStatusLog
 * dentro de la misma transacción. Si la transición es a CANCELLED desde
 * PENDING/CONFIRMED, restaura el stock.
 *
 * Cambios respecto a la versión anterior:
 *  - Crea OrderStatusLog (auditoría)
 *  - Acepta una nota opcional
 *  - Mantiene la restauración de stock
 */
export const updateOrderStatus = async (orderId, toStatus, { changedById, note } = {}) => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } })
    if (!order) {
      const err = new Error('Orden no encontrada')
      err.status = 404
      throw err
    }

    if (order.status === toStatus) {
      // No-op, no registrar log redundante
      return tx.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE })
    }

    const fromStatus = order.status
    const wasPendingOrConfirmed = fromStatus === 'PENDING' || fromStatus === 'CONFIRMED'
    const isNowCancelled = toStatus === 'CANCELLED'

    // Actualizar status
    await tx.order.update({
      where: { id: orderId },
      data: { status: toStatus },
    })

    // Registrar log
    await tx.orderStatusLog.create({
      data: {
        orderId,
        fromStatus,
        toStatus,
        changedById: changedById || null,
        note: note || null,
      },
    })

    // Si vamos a CANCELLED desde PENDING/CONFIRMED, restaurar stock.
    // Hacemos esto aquí mismo dentro de la transacción usando $executeRaw-like
    // para evitar una segunda conexión.
    if (wasPendingOrConfirmed && isNowCancelled) {
      const items = await tx.orderItem.findMany({ where: { orderId } })
      for (const item of items) {
        if (item.size && item.color) {
          const variant = await tx.productVariant.findFirst({
            where: {
              productId: item.productId,
              size: item.size,
              color: item.color,
            },
          })
          if (variant) {
            await tx.productVariant.update({
              where: { id: variant.id },
              data: { stock: { increment: item.quantity } },
            })
            continue
          }
        }
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        })
      }
    }

    return tx.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE })
  })
}
