import { prisma } from '../config/prisma.js'
import { tryDeductStockForItems, restoreStockForItems } from './stock.service.js'

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

const buildListWhere = ({ status, userId, dateFrom, dateTo, search, needsReview }) => {
  const where = {}
  if (status) where.status = status
  if (needsReview === 'true' || needsReview === true) where.needsReview = true
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
  needsReview,
} = {}) => {
  const where = buildListWhere({ status, userId, dateFrom, dateTo, search, needsReview })
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

// Transiciones permitidas desde el admin.
export const ALLOWED_TRANSITIONS = {
  PENDING:    ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:  ['PROCESSING', 'SHIPPED', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED:    ['DELIVERED', 'REFUNDED'],
  DELIVERED:  ['REFUNDED'],
  CANCELLED:  [],
  REFUNDED:   [],
}

const conflict = (message) => Object.assign(new Error(message), { status: 409 })

/**
 * Cambia el estado de una orden y registra el cambio en OrderStatusLog, todo
 * en una transacción con la orden bloqueada.
 *
 *  - PENDING → CONFIRMED (pago manual, p. ej. transferencia): descuenta stock.
 *  - → CANCELLED / REFUNDED: devuelve stock SÓLO si se había descontado
 *    (stockDeducted). Cancelar una orden sin pagar no toca el inventario.
 *  - El reembolso del dinero se hace en el panel de Wompi/MercadoPago.
 */
export const updateOrderStatus = async (orderId, toStatus, { changedById, note } = {}) => {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE`
    if (locked.length === 0) {
      const err = new Error('Orden no encontrada')
      err.status = 404
      throw err
    }
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })

    if (order.status === toStatus) {
      return tx.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE })
    }

    const allowed = ALLOWED_TRANSITIONS[order.status] || []
    if (!allowed.includes(toStatus)) {
      throw conflict(`No se puede pasar una orden de ${order.status} a ${toStatus}`)
    }

    const data = { status: toStatus }

    if (toStatus === 'CONFIRMED' && !order.stockDeducted) {
      const stock = await tryDeductStockForItems(tx, order.items)
      if (!stock.ok) {
        throw Object.assign(conflict('No hay stock suficiente para confirmar esta orden'), {
          code: 'INSUFFICIENT_STOCK', details: stock.shortages,
        })
      }
      data.stockDeducted = true
      data.paidAt = order.paidAt ?? new Date()
    }

    if ((toStatus === 'CANCELLED' || toStatus === 'REFUNDED') && order.stockDeducted) {
      await restoreStockForItems(tx, order.items)
      data.stockDeducted = false
    }

    if (toStatus === 'CANCELLED' || toStatus === 'REFUNDED' || toStatus === 'DELIVERED') {
      data.needsReview = false
    }

    await tx.order.update({ where: { id: orderId }, data })

    await tx.orderStatusLog.create({
      data: {
        orderId,
        fromStatus: order.status,
        toStatus,
        changedById: changedById || null,
        note: note || null,
      },
    })

    return tx.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE })
  }, { timeout: 15_000 })
}

/** Marca una orden como revisada (quita la alerta needsReview). */
export const resolveReview = async (orderId, { changedById, note } = {}) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) {
    const err = new Error('Orden no encontrada')
    err.status = 404
    throw err
  }
  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { needsReview: false } }),
    prisma.orderStatusLog.create({
      data: {
        orderId, fromStatus: order.status, toStatus: order.status,
        changedById: changedById || null,
        note: `Revisión resuelta${note ? `: ${note}` : ''} (motivo original: ${order.reviewNote || '—'})`,
      },
    }),
  ])
  return prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE })
}
