import * as OrderService from '../services/order.service.js'
import { getCustomerInvoicePdf } from '../services/einvoice/einvoice.service.js'

export const quoteOrder = async (req, res, next) => {
  try {
    const quote = await OrderService.quoteOrder(req.body)
    res.json(quote)
  } catch (err) { next(err) }
}

export const createOrder = async (req, res, next) => {
  try {
    const order = await OrderService.createOrder(req.user.id, req.body)
    res.status(201).json(order)
  } catch (err) { next(err) }
}

export const getOrders = async (req, res, next) => {
  try {
    const orders = await OrderService.getOrders(req.user.id)
    res.json(orders)
  } catch (err) { next(err) }
}

export const getOrderById = async (req, res, next) => {
  try {
    const order = await OrderService.getOrderById(req.user.id, req.params.id)
    res.json(order)
  } catch (err) { next(err) }
}

export const getInvoicePdf = async (req, res, next) => {
  try {
    const { pdf, fileName } = await getCustomerInvoicePdf(req.user.id, req.params.id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.send(pdf)
  } catch (err) { next(err) }
}
