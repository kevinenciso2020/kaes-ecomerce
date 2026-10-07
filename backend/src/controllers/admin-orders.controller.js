import * as AdminOrders from '../services/admin-orders.service.js'
import { sendOrderCancelled } from '../services/email.service.js'

export const listOrders = async (req, res, next) => {
  try {
    const result = await AdminOrders.listOrders(req.query)
    res.json(result)
  } catch (err) { next(err) }
}

export const getOrderById = async (req, res, next) => {
  try {
    const order = await AdminOrders.getOrderById(req.params.id)
    res.json(order)
  } catch (err) { next(err) }
}

export const updateOrderStatus = async (req, res, next) => {
  try {
    const order = await AdminOrders.updateOrderStatus(
      req.params.id,
      req.body.status,
      {
        changedById: req.user?.id,
        note:        req.body.note,
      },
    )
    if (req.body.status === 'CANCELLED') {
      // Aviso al cliente (no bloquea la respuesta si el SMTP falla)
      Promise.resolve().then(() => sendOrderCancelled(order.id)).catch((err) => req.log?.error({ err, orderId: order.id }, 'email.order_cancelled_failed'))
    }
    res.json(order)
  } catch (err) { next(err) }
}

export const resolveReview = async (req, res, next) => {
  try {
    const order = await AdminOrders.resolveReview(req.params.id, {
      changedById: req.user?.id,
      note: typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined,
    })
    res.json(order)
  } catch (err) { next(err) }
}
