import * as AdminOrders from '../services/admin-orders.service.js'

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
    res.json(order)
  } catch (err) { next(err) }
}
