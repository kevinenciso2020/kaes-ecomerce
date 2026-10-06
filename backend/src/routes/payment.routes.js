import express from 'express'
import { Preference, Payment } from 'mercadopago'

import { getMpClient, isMercadoPagoConfigured, verifyMpSignature } from '../config/mercadopago.js'
import * as wompi from '../config/wompi.js'
import { prisma } from '../config/prisma.js'
import { captureError } from '../config/sentry.js'
import { isAuth } from '../middleware/auth.middleware.js'
import { requireVerifiedEmail } from '../middleware/requireVerifiedEmail.middleware.js'
import { paymentInitLimiter } from '../middleware/rateLimit.middleware.js'
import {
  processPaymentUpdate,
  mapMercadoPagoStatus,
  mapWompiStatus,
} from '../services/payment.service.js'

const router = express.Router()

const isAdminRole = (role) => role === 'ADMIN' || role === 'SUPER_ADMIN'

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code })

// Tiempo que el cliente tiene para completar el pago en la pasarela.
const CHECKOUT_TTL_MINUTES = 60

/** Carga una orden del usuario lista para pagar o lanza el error adecuado. */
const loadPayableOrder = async (orderId, user) => {
  if (!orderId || typeof orderId !== 'string') throw httpError(400, 'orderId requerido')

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { email: true, name: true } },
      items: true,
      shippingAddress: true,
      payment: { select: { status: true } },
    },
  })
  if (!order || (order.userId !== user.id && !isAdminRole(user.role))) {
    throw httpError(404, 'Orden no encontrada')
  }
  if (order.stockDeducted || order.status === 'CONFIRMED') {
    throw httpError(409, 'Esta orden ya está pagada', 'ORDER_ALREADY_PAID')
  }
  // Un pago aprobado que no pudo confirmar la orden (sin stock, monto distinto)
  // la deja PENDING + needsReview: cobrarla otra vez sería un doble cobro.
  if (order.needsReview || ['COMPLETED', 'REFUNDED'].includes(order.payment?.status)) {
    throw httpError(409, 'Esta orden tiene un pago en revisión. Te contactaremos; no es necesario pagar de nuevo.', 'ORDER_IN_REVIEW')
  }
  if (order.status !== 'PENDING') {
    throw httpError(409, 'Esta orden ya no se puede pagar. Crea un pedido nuevo desde tu carrito.', 'ORDER_NOT_PAYABLE')
  }

  // Revalidar stock antes de mandar al cliente a pagar (informativo: el stock
  // se descuenta atómicamente cuando el pago se aprueba).
  for (const item of order.items) {
    const source = item.variantId
      ? await prisma.productVariant.findUnique({ where: { id: item.variantId }, select: { stock: true } })
      : await prisma.product.findUnique({ where: { id: item.productId }, select: { stock: true } })
    if (!source || source.stock < item.quantity) {
      throw httpError(409, 'Uno de los productos de tu pedido se agotó. Revisa tu carrito.', 'INSUFFICIENT_STOCK')
    }
  }
  return order
}

const frontendUrl = () => (process.env.FRONTEND_URL || '').replace(/\/$/, '')
const backendUrl = () => (process.env.BACKEND_URL || '').replace(/\/$/, '')

// ─────────────────────────────────────────
// POST /api/v1/payments/wompi/checkout
// Devuelve la URL del Web Checkout de Wompi para una orden PENDING.
// ─────────────────────────────────────────
const wompiCheckout = async (req, res, next) => {
  try {
    if (!wompi.isWompiConfigured()) throw httpError(503, 'Pagos con Wompi no disponibles en este momento')

    const order = await loadPayableOrder(req.body?.orderId, req.user)
    const amountInCents = Math.round(Number(order.total) * 100)
    const reference = wompi.buildReference(order.id)
    const expirationTime = new Date(Date.now() + CHECKOUT_TTL_MINUTES * 60 * 1000).toISOString()

    const checkoutUrl = wompi.buildCheckoutUrl({
      reference,
      amountInCents,
      currency: 'COP',
      redirectUrl: `${frontendUrl()}/checkout/resultado?orderId=${order.id}&provider=wompi`,
      customerEmail: order.user.email,
      customerName: order.shippingAddress?.fullName || order.user.name,
      customerPhone: order.shippingAddress?.phone || undefined,
      expirationTime,
    })

    await prisma.order.update({
      where: { id: order.id },
      data: { paymentProvider: 'WOMPI', mpPreferenceId: reference },
    })

    req.log?.info({ orderId: order.id, reference, amountInCents }, 'payment.wompi.checkout_created')
    return res.json({ checkoutUrl, reference })
  } catch (err) {
    next(err)
  }
}
router.post('/wompi/checkout', isAuth, requireVerifiedEmail, paymentInitLimiter, wompiCheckout)
// Alias de compatibilidad con el frontend anterior.
router.post('/wompi/create-checkout', isAuth, requireVerifiedEmail, paymentInitLimiter, wompiCheckout)

// ─────────────────────────────────────────
// POST /api/v1/payments/wompi/webhook
// Evento firmado de Wompi (transaction.updated).
// ─────────────────────────────────────────
router.post('/wompi/webhook', async (req, res) => {
  let event
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {})
    event = JSON.parse(raw)
  } catch {
    return res.status(400).json({ error: 'JSON inválido' })
  }

  const check = wompi.verifyEventChecksum(event, req.headers['x-event-checksum'])
  if (!check.valid) {
    req.log?.warn({ provider: 'wompi', reason: check.reason }, 'payment.webhook.signature_invalid')
    return res.status(401).json({ error: 'Firma inválida' })
  }

  if (event.event !== 'transaction.updated') return res.sendStatus(200)

  const tx = event.data?.transaction
  const orderId = wompi.orderIdFromReference(tx?.reference)
  if (!tx?.id || !orderId) {
    req.log?.warn({ provider: 'wompi', reference: tx?.reference }, 'payment.webhook.unknown_reference')
    return res.sendStatus(200)
  }

  try {
    const result = await processPaymentUpdate({
      provider: 'WOMPI',
      orderId,
      providerPaymentId: tx.id,
      status: mapWompiStatus(tx.status),
      amount: Number(tx.amount_in_cents) / 100,
      currency: tx.currency,
      payload: event,
      source: 'webhook',
    })
    req.log?.info({ provider: 'wompi', orderId, transactionId: tx.id, wompiStatus: tx.status, outcome: result.outcome }, 'payment.webhook.processed')
    return res.sendStatus(200)
  } catch (err) {
    // 500 → Wompi reintenta. Es seguro porque el procesamiento es idempotente.
    req.log?.error({ err, provider: 'wompi', orderId, transactionId: tx.id }, 'payment.webhook.processing_failed')
    captureError(err, { provider: 'wompi', orderId, transactionId: tx.id })
    return res.status(500).json({ error: 'Error procesando el evento' })
  }
})

// ─────────────────────────────────────────
// POST /api/v1/payments/create-preference   (MercadoPago)
// ─────────────────────────────────────────
router.post('/create-preference', isAuth, requireVerifiedEmail, paymentInitLimiter, async (req, res, next) => {
  try {
    if (!isMercadoPagoConfigured()) throw httpError(503, 'Pagos con MercadoPago no disponibles en este momento')

    const order = await loadPayableOrder(req.body?.orderId, req.user)
    const shortId = order.id.slice(-8).toUpperCase()

    // Un solo ítem por el TOTAL de la orden: así el monto cobrado incluye
    // exactamente descuentos, cupón y envío calculados por el servidor.
    const preference = await new Preference(getMpClient()).create({
      body: {
        items: [{
          id: order.id,
          title: `Pedido KAES #${shortId}`,
          description: `${order.items.length} producto(s)`,
          quantity: 1,
          unit_price: Number(order.total),
          currency_id: 'COP',
        }],
        payer: { email: order.user.email, name: order.shippingAddress?.fullName || order.user.name },
        back_urls: {
          success: `${frontendUrl()}/checkout/resultado?orderId=${order.id}&provider=mercadopago`,
          failure: `${frontendUrl()}/checkout/resultado?orderId=${order.id}&provider=mercadopago`,
          pending: `${frontendUrl()}/checkout/resultado?orderId=${order.id}&provider=mercadopago`,
        },
        auto_return: 'approved',
        external_reference: order.id,
        notification_url: `${backendUrl()}/api/v1/payments/webhook`,
        statement_descriptor: 'KAES STORE',
        expires: true,
        expiration_date_to: new Date(Date.now() + CHECKOUT_TTL_MINUTES * 60 * 1000).toISOString(),
      },
    })

    await prisma.order.update({
      where: { id: order.id },
      data: { mpPreferenceId: preference.id, paymentProvider: 'MERCADOPAGO' },
    })

    req.log?.info({ orderId: order.id, preferenceId: preference.id }, 'payment.mp.preference_created')
    // init_point sirve tanto para credenciales de prueba como productivas.
    return res.json({ preferenceId: preference.id, checkoutUrl: preference.init_point, initPoint: preference.init_point })
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────
// POST /api/v1/payments/webhook   (MercadoPago)
// ─────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  let body = {}
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''
    body = raw ? JSON.parse(raw) : {}
  } catch {
    body = {}
  }

  const topic = req.query.type || req.query.topic || body.type || body.topic
  const dataId = req.query['data.id'] || body?.data?.id || (req.query.topic ? req.query.id : undefined)

  // Si llega firma se verifica (Webhooks). Las notificaciones IPN antiguas no
  // traen firma; en ambos casos el estado real se consulta a la API de MP con
  // nuestro access token, así que el cuerpo de la notificación nunca se usa
  // como fuente de verdad.
  if (req.headers['x-signature']) {
    const check = verifyMpSignature({
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId,
    })
    if (!check.valid) {
      req.log?.warn({ provider: 'mercadopago', reason: check.reason }, 'payment.webhook.signature_invalid')
      return res.status(401).json({ error: 'Firma inválida' })
    }
  } else {
    req.log?.info({ provider: 'mercadopago', topic }, 'payment.webhook.unsigned_notification')
  }

  if (topic !== 'payment' || !dataId) return res.sendStatus(200)
  if (!isMercadoPagoConfigured()) return res.sendStatus(200)

  try {
    const payment = await new Payment(getMpClient()).get({ id: String(dataId) })
    const orderId = payment.external_reference
    if (!orderId) return res.sendStatus(200)

    const result = await processPaymentUpdate({
      provider: 'MERCADOPAGO',
      orderId,
      providerPaymentId: String(payment.id),
      status: mapMercadoPagoStatus(payment.status),
      amount: Number(payment.transaction_amount),
      currency: payment.currency_id,
      payload: { id: payment.id, status: payment.status, status_detail: payment.status_detail, transaction_amount: payment.transaction_amount, external_reference: payment.external_reference, payment_method_id: payment.payment_method_id },
      source: 'webhook',
    })
    req.log?.info({ provider: 'mercadopago', orderId, paymentId: payment.id, mpStatus: payment.status, outcome: result.outcome }, 'payment.webhook.processed')
    return res.sendStatus(200)
  } catch (err) {
    req.log?.error({ err, provider: 'mercadopago', dataId }, 'payment.webhook.processing_failed')
    captureError(err, { provider: 'mercadopago', dataId })
    return res.status(500).json({ error: 'Error procesando la notificación' })
  }
})

// ─────────────────────────────────────────
// POST /api/v1/payments/verify/:orderId
// Respaldo del webhook: la página de resultado pide verificar el pago
// directamente con el proveedor (fuente de verdad) y lo procesa igual que un
// webhook (idempotente). Sirve si el webhook se demora o falla.
// ─────────────────────────────────────────
router.post('/verify/:orderId', isAuth, paymentInitLimiter, async (req, res, next) => {
  try {
    const { orderId } = req.params
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, userId: true, mpPreferenceId: true, paymentProvider: true } })
    if (!order || (order.userId !== req.user.id && !isAdminRole(req.user.role))) {
      throw httpError(404, 'Orden no encontrada')
    }

    const provider = req.body?.provider || (order.paymentProvider === 'MERCADOPAGO' ? 'mercadopago' : 'wompi')
    const updates = []

    // Consultar al proveedor es "best effort": si su API falla, se registra y
    // se responde con el estado actual de la orden (el webhook sigue siendo la
    // vía principal). Nunca se propaga el error HTTP del proveedor al cliente.
    const safely = async (label, fn) => {
      try {
        return await fn()
      } catch (err) {
        req.log?.warn({ err: err.message, status: err.response?.status, orderId: order.id, provider: label }, 'payment.verify.provider_unavailable')
        return null
      }
    }

    if (provider === 'wompi' && wompi.isWompiConfigured()) {
      let transactions = []
      if (req.body?.transactionId) {
        const t = await safely('wompi', () => wompi.getTransaction(String(req.body.transactionId)))
        if (t) transactions = [t]
      } else if (order.mpPreferenceId?.startsWith('KAES-') && process.env.WOMPI_PRIVATE_KEY) {
        transactions = (await safely('wompi', () => wompi.findTransactionsByReference(order.mpPreferenceId))) || []
      }
      for (const t of transactions) {
        if (wompi.orderIdFromReference(t.reference) !== order.id) continue
        updates.push({
          provider: 'WOMPI', providerPaymentId: t.id, status: mapWompiStatus(t.status),
          amount: Number(t.amount_in_cents) / 100, currency: t.currency, payload: { transaction: t },
        })
      }
    }

    if (provider === 'mercadopago' && isMercadoPagoConfigured()) {
      const paymentApi = new Payment(getMpClient())
      let payments = []
      if (req.body?.paymentId) {
        const p = await safely('mercadopago', () => paymentApi.get({ id: String(req.body.paymentId) }))
        payments = p ? [p] : []
      } else {
        const found = await safely('mercadopago', () => paymentApi.search({ options: { external_reference: order.id } }))
        payments = found?.results || []
      }
      for (const p of payments) {
        if (p?.external_reference !== order.id) continue
        updates.push({
          provider: 'MERCADOPAGO', providerPaymentId: String(p.id), status: mapMercadoPagoStatus(p.status),
          amount: Number(p.transaction_amount), currency: p.currency_id,
          payload: { id: p.id, status: p.status, status_detail: p.status_detail, transaction_amount: p.transaction_amount },
        })
      }
    }

    for (const u of updates) {
      await processPaymentUpdate({ ...u, orderId: order.id, source: 'verify' })
    }

    const fresh = await prisma.order.findUnique({
      where: { id: order.id },
      select: { id: true, status: true, paidAt: true, total: true, needsReview: true, payment: { select: { status: true, provider: true } } },
    })
    return res.json(fresh)
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────
// GET /api/v1/payments/status/:orderId
// ─────────────────────────────────────────
router.get('/status/:orderId', isAuth, async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      select: {
        id: true, status: true, paidAt: true, total: true, userId: true, needsReview: true,
        payment: { select: { status: true, provider: true } },
      },
    })
    if (!order || (order.userId !== req.user.id && !isAdminRole(req.user.role))) {
      return res.status(404).json({ error: 'Orden no encontrada' })
    }
    const { userId, ...rest } = order
    return res.json(rest)
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────
// GET /api/v1/payments/methods — qué pasarelas están activas
// ─────────────────────────────────────────
router.get('/methods', (req, res) => {
  res.json({
    wompi: wompi.isWompiConfigured(),
    mercadopago: isMercadoPagoConfigured() && process.env.MP_ENABLED !== 'false',
  })
})

export default router
