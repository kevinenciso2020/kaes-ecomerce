import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'

// Rutas de pago con la BD y los proveedores mockeados. La lógica transaccional
// real (idempotencia, stock, carreras) se prueba contra PostgreSQL en
// tests/db/payments.db.test.js.

const mocks = vi.hoisted(() => ({
  prisma: {
    order: { findUnique: vi.fn(), update: vi.fn() },
    product: { findUnique: vi.fn() },
    productVariant: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  processPaymentUpdate: vi.fn(),
  preferenceCreate: vi.fn(),
  paymentGet: vi.fn(),
  paymentSearch: vi.fn(),
  getTransaction: vi.fn(),
}))

vi.mock('../../src/config/prisma.js', () => ({ prisma: mocks.prisma }))

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

vi.mock('../../src/services/payment.service.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, processPaymentUpdate: mocks.processPaymentUpdate }
})

vi.mock('mercadopago', () => ({
  MercadoPagoConfig: vi.fn(),
  Preference: vi.fn().mockImplementation(function () { return { create: mocks.preferenceCreate } }),
  Payment: vi.fn().mockImplementation(function () { return { get: mocks.paymentGet, search: mocks.paymentSearch } }),
}))

vi.mock('../../src/config/wompi.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getTransaction: mocks.getTransaction, default: { ...actual.default, getTransaction: mocks.getTransaction } }
})

import request from 'supertest'
import app from '../../src/app.js'

const tokenFor = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' })
const customerToken = () => tokenFor({ id: 'u1', email: 'c@d.com', role: 'CUSTOMER', emailVerified: true })
const otherToken = () => tokenFor({ id: 'u2', email: 'x@d.com', role: 'CUSTOMER', emailVerified: true })

const baseOrder = (overrides = {}) => ({
  id: 'ord1',
  userId: 'u1',
  status: 'PENDING',
  stockDeducted: false,
  total: '64900',
  paymentProvider: null,
  mpPreferenceId: null,
  user: { email: 'c@d.com', name: 'Cliente' },
  shippingAddress: { fullName: 'Cliente Uno', phone: '3001234567' },
  items: [{ productId: 'p1', variantId: null, quantity: 1 }],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_abc'
  process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity'
  process.env.WOMPI_EVENTS_SECRET = 'test_events'
  process.env.MP_WEBHOOK_SECRET = 'mp_secret'
  process.env.FRONTEND_URL = 'http://localhost:4321'
  process.env.BACKEND_URL = 'https://api.kaes.test'
  mocks.prisma.product.findUnique.mockResolvedValue({ stock: 10 })
  mocks.prisma.order.update.mockResolvedValue({})
  mocks.processPaymentUpdate.mockResolvedValue({ outcome: 'CONFIRMED', duplicate: false })
})

// ─────────────────────────────────────────────────────────────
// Wompi checkout
// ─────────────────────────────────────────────────────────────
describe('POST /api/v1/payments/wompi/checkout', () => {
  const post = (token, body) =>
    request(app).post('/api/v1/payments/wompi/checkout').set('Authorization', `Bearer ${token}`).send(body)

  it('401 sin sesión', async () => {
    const res = await request(app).post('/api/v1/payments/wompi/checkout').send({ orderId: 'ord1' })
    expect(res.status).toBe(401)
  })

  it('devuelve la URL del Web Checkout con el TOTAL de la orden y firma de integridad', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder())
    const res = await post(customerToken(), { orderId: 'ord1' })
    expect(res.status).toBe(200)
    const url = new URL(res.body.checkoutUrl)
    expect(url.hostname).toBe('checkout.wompi.co')
    expect(url.searchParams.get('amount-in-cents')).toBe('6490000')
    expect(url.searchParams.get('reference')).toMatch(/^KAES-ord1-/)
    expect(url.searchParams.get('redirect-url')).toBe('http://localhost:4321/checkout/resultado?orderId=ord1&provider=wompi')
    expect(url.searchParams.get('signature:integrity')).toMatch(/^[a-f0-9]{64}$/)
    expect(mocks.prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'ord1' },
      data: { paymentProvider: 'WOMPI', mpPreferenceId: res.body.reference },
    })
  })

  it('404 si la orden es de otro usuario (no revela que existe)', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder())
    const res = await post(otherToken(), { orderId: 'ord1' })
    expect(res.status).toBe(404)
  })

  it('409 si la orden ya está pagada o cancelada', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder({ status: 'CONFIRMED', stockDeducted: true }))
    expect((await post(customerToken(), { orderId: 'ord1' })).body.code).toBe('ORDER_ALREADY_PAID')
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder({ status: 'CANCELLED' }))
    expect((await post(customerToken(), { orderId: 'ord1' })).status).toBe(409)
  })

  it('409 si un producto se agotó antes de pagar', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder())
    mocks.prisma.product.findUnique.mockResolvedValueOnce({ stock: 0 })
    const res = await post(customerToken(), { orderId: 'ord1' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('INSUFFICIENT_STOCK')
  })

  it('503 si Wompi no está configurado', async () => {
    delete process.env.WOMPI_INTEGRITY_SECRET
    const res = await post(customerToken(), { orderId: 'ord1' })
    expect(res.status).toBe(503)
  })

  it('403 si el email no está verificado (confirmado contra la BD)', async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce({ emailVerified: false, isActive: true })
    const res = await post(tokenFor({ id: 'u1', role: 'CUSTOMER', emailVerified: false }), { orderId: 'ord1' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('deja pasar si el token está desactualizado pero la BD dice verificado', async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce({ emailVerified: true, isActive: true })
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder())
    const res = await post(tokenFor({ id: 'u1', role: 'CUSTOMER', emailVerified: false }), { orderId: 'ord1' })
    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────
// Wompi webhook
// ─────────────────────────────────────────────────────────────
describe('POST /api/v1/payments/wompi/webhook', () => {
  const signedEvent = (tx, secret = 'test_events') => {
    const event = {
      event: 'transaction.updated',
      data: { transaction: tx },
      signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'] },
      timestamp: 1790000000,
    }
    event.signature.checksum = crypto.createHash('sha256')
      .update(`${tx.id}${tx.status}${tx.amount_in_cents}${event.timestamp}${secret}`).digest('hex').toUpperCase()
    return event
  }
  const tx = { id: 'tx-1', status: 'APPROVED', amount_in_cents: 6490000, reference: 'KAES-ord1-abc', currency: 'COP' }

  const send = (event) =>
    request(app).post('/api/v1/payments/wompi/webhook').set('Content-Type', 'application/json').send(JSON.stringify(event))

  it('procesa un evento firmado (sin Origin: exento de CSRF) y responde 200', async () => {
    const res = await send(signedEvent(tx))
    expect(res.status).toBe(200)
    expect(mocks.processPaymentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'WOMPI', orderId: 'ord1', providerPaymentId: 'tx-1', status: 'APPROVED', amount: 64900, source: 'webhook',
    }))
  })

  it('401 con firma inválida o evento alterado', async () => {
    const event = signedEvent(tx)
    event.data.transaction.amount_in_cents = 100
    const res = await send(event)
    expect(res.status).toBe(401)
    expect(mocks.processPaymentUpdate).not.toHaveBeenCalled()
  })

  it('401 si la firma fue hecha con otro secreto', async () => {
    const res = await send(signedEvent(tx, 'secreto_falso'))
    expect(res.status).toBe(401)
  })

  it('500 si el procesamiento falla (Wompi reintenta; es idempotente)', async () => {
    mocks.processPaymentUpdate.mockRejectedValueOnce(new Error('db caída'))
    const res = await send(signedEvent(tx))
    expect(res.status).toBe(500)
  })

  it('200 sin procesar si la referencia no es de esta tienda', async () => {
    const res = await send(signedEvent({ ...tx, reference: 'otra-tienda-123' }))
    expect(res.status).toBe(200)
    expect(mocks.processPaymentUpdate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────
// MercadoPago
// ─────────────────────────────────────────────────────────────
describe('POST /api/v1/payments/create-preference', () => {
  it('crea una preferencia por el TOTAL de la orden con notification_url en /api/v1', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder())
    mocks.preferenceCreate.mockResolvedValueOnce({ id: 'pref-1', init_point: 'https://mp/init', sandbox_init_point: 'https://sandbox/init' })

    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Authorization', `Bearer ${customerToken()}`)
      .send({ orderId: 'ord1' })

    expect(res.status).toBe(200)
    // Nunca se usa sandbox_init_point
    expect(res.body.checkoutUrl).toBe('https://mp/init')
    const body = mocks.preferenceCreate.mock.calls[0][0].body
    expect(body.items).toEqual([expect.objectContaining({ quantity: 1, unit_price: 64900, currency_id: 'COP' })])
    expect(body.notification_url).toBe('https://api.kaes.test/api/v1/payments/webhook')
    expect(body.external_reference).toBe('ord1')
  })

  it('404 para la orden de otro usuario', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder())
    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Authorization', `Bearer ${otherToken()}`)
      .send({ orderId: 'ord1' })
    expect(res.status).toBe(404)
    expect(mocks.preferenceCreate).not.toHaveBeenCalled()
  })

  it('responde (no se cuelga) si MercadoPago falla', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder())
    mocks.preferenceCreate.mockRejectedValueOnce(new Error('MP caído'))
    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Authorization', `Bearer ${customerToken()}`)
      .send({ orderId: 'ord1' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Error interno del servidor')
  })
})

describe('POST /api/v1/payments/webhook (MercadoPago)', () => {
  const sign = (dataId, requestId, ts = '1790000000') => {
    const v1 = crypto.createHmac('sha256', 'mp_secret').update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')
    return `ts=${ts},v1=${v1}`
  }

  it('verifica la firma con data.id del query y procesa el pago consultado a la API de MP', async () => {
    mocks.paymentGet.mockResolvedValueOnce({ id: 555, status: 'approved', transaction_amount: 64900, currency_id: 'COP', external_reference: 'ord1' })
    const res = await request(app)
      .post('/api/v1/payments/webhook?data.id=555&type=payment')
      .set('x-signature', sign('555', 'req-1'))
      .set('x-request-id', 'req-1')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'payment', data: { id: '555' } }))

    expect(res.status).toBe(200)
    expect(mocks.paymentGet).toHaveBeenCalledWith({ id: '555' })
    expect(mocks.processPaymentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'MERCADOPAGO', orderId: 'ord1', providerPaymentId: '555', status: 'APPROVED', amount: 64900,
    }))
  })

  it('401 si la firma no coincide', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook?data.id=555&type=payment')
      .set('x-signature', sign('999', 'req-1'))
      .set('x-request-id', 'req-1')
      .send({})
    expect(res.status).toBe(401)
    expect(mocks.paymentGet).not.toHaveBeenCalled()
  })

  it('ignora (200) notificaciones que no son de pagos', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook?topic=merchant_order&id=1')
      .send({})
    expect(res.status).toBe(200)
    expect(mocks.paymentGet).not.toHaveBeenCalled()
  })

  it('la ruta antigua sin /v1 ya no es la notification_url', async () => {
    const res = await request(app).post('/api/payments/webhook').send({})
    expect(res.status).not.toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────
// Verificación manual y estado
// ─────────────────────────────────────────────────────────────
describe('POST /api/v1/payments/verify/:orderId', () => {
  it('consulta la transacción en Wompi y la procesa como un webhook', async () => {
    mocks.prisma.order.findUnique
      .mockResolvedValueOnce({ id: 'ord1', userId: 'u1', mpPreferenceId: 'KAES-ord1-abc', paymentProvider: 'WOMPI' })
      .mockResolvedValueOnce({ id: 'ord1', status: 'CONFIRMED', paidAt: new Date(), total: '64900', needsReview: false, payment: { status: 'COMPLETED', provider: 'WOMPI' } })
    mocks.getTransaction.mockResolvedValueOnce({ id: 'tx-9', status: 'APPROVED', amount_in_cents: 6490000, reference: 'KAES-ord1-abc', currency: 'COP' })

    const res = await request(app)
      .post('/api/v1/payments/verify/ord1')
      .set('Authorization', `Bearer ${customerToken()}`)
      .send({ provider: 'wompi', transactionId: 'tx-9' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
    expect(mocks.processPaymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ providerPaymentId: 'tx-9', source: 'verify' }))
  })

  it('ignora transacciones cuya referencia es de otra orden', async () => {
    mocks.prisma.order.findUnique
      .mockResolvedValueOnce({ id: 'ord1', userId: 'u1', mpPreferenceId: null, paymentProvider: 'WOMPI' })
      .mockResolvedValueOnce({ id: 'ord1', status: 'PENDING' })
    mocks.getTransaction.mockResolvedValueOnce({ id: 'tx-x', status: 'APPROVED', amount_in_cents: 100, reference: 'KAES-otra-abc' })

    const res = await request(app)
      .post('/api/v1/payments/verify/ord1')
      .set('Authorization', `Bearer ${customerToken()}`)
      .send({ provider: 'wompi', transactionId: 'tx-x' })
    expect(res.status).toBe(200)
    expect(mocks.processPaymentUpdate).not.toHaveBeenCalled()
  })

  it('404 para órdenes ajenas', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce({ id: 'ord1', userId: 'u1' })
    const res = await request(app).post('/api/v1/payments/verify/ord1').set('Authorization', `Bearer ${otherToken()}`).send({})
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/payments/status/:orderId', () => {
  it('SUPER_ADMIN también puede consultar cualquier orden', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce({ id: 'ord1', userId: 'u1', status: 'PENDING', total: '1', needsReview: false })
    const res = await request(app)
      .get('/api/v1/payments/status/ord1')
      .set('Authorization', `Bearer ${tokenFor({ id: 'sa', role: 'SUPER_ADMIN' })}`)
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('userId')
  })
})
