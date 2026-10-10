import * as AdminOrders from '../services/admin-orders.service.js'
import { sendOrderCancelled } from '../services/email.service.js'
import * as Einvoice from '../services/einvoice/einvoice.service.js'

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
    // Facturación electrónica (sin efecto si está apagada): pago manual → factura;
    // anulación de una orden facturada → nota crédito.
    if (req.body.status === 'CONFIRMED') Einvoice.triggerInvoice(order.id)
    if (req.body.status === 'CANCELLED' || req.body.status === 'REFUNDED') {
      Einvoice.triggerCreditNote(order.id, req.body.status === 'REFUNDED' ? 'Devolución del pedido (reembolso)' : 'Pedido cancelado')
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

export const getOrderEinvoice = async (req, res, next) => {
  try {
    res.json(await Einvoice.getDocumentsForOrder(req.params.id))
  } catch (err) { next(err) }
}

export const retryEinvoice = async (req, res, next) => {
  try {
    res.json(await Einvoice.retryDocument(req.params.docId))
  } catch (err) { next(err) }
}

export const downloadEinvoiceXml = async (req, res, next) => {
  try {
    const { xml, fileName } = await Einvoice.getDocumentXml(req.params.docId)
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.send(xml)
  } catch (err) { next(err) }
}

export const downloadEinvoicePdf = async (req, res, next) => {
  try {
    const { pdf, fileName } = await Einvoice.getDocumentPdf(req.params.docId)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
    res.send(pdf)
  } catch (err) { next(err) }
}
