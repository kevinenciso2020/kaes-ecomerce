import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'

const mocks = vi.hoisted(() => ({
  prisma: {
    order: { findUnique: vi.fn(), update: vi.fn() },
    payment: { upsert: vi.fn() },
  },
  preferenceCreate: vi.fn(),
  paymentGet: vi.fn(),
  discountStock: vi.fn(),
  restoreStock: vi.fn(),
  sendOrderConfirmation: vi.fn(),
  sendOrderCancelled: vi.fn(),
  wompiGetPresignedAcceptance: vi.fn(),
  wompiCreateTransaction: vi.fn(),
}))

vi.mock('../../src/config/prisma.js', () => ({ prisma: mocks.prisma }))

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

vi.mock('../../src/services/stock.service.js', () => ({
  discountStock: mocks.discountStock,
  restoreStock: mocks.restoreStock,
}))

vi.mock('../../src/services/email.service.js', () => ({
  sendOrderConfirmation: mocks.sendOrderConfirmation,
  sendOrderCancelled: mocks.sendOrderCancelled,
}))

vi.mock('../../src/config/mercadopago.js', () => ({
  default: { accessToken: 'TEST' },
}))

vi.mock('mercadopago', () => ({
  Preference: vi.fn().mockImplementation(() => ({ create: mocks.preferenceCreate })),
  Payment: vi.fn().mockImplementation(() => ({ get: mocks.paymentGet })),
}))

vi.mock('../../src/config/wompi.js', () => ({
  default: {
    getPresignedAcceptance: mocks.wompiGetPresignedAcceptance,
    createTransaction: mocks.wompiCreateTransaction,
    getTransaction: vi.fn(),
  },
}))

import request from 'supertest'
import app from '../../src/app.js'

const tokenFor = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' })

const customerToken = () =>
  tokenFor({ id: 'u1', email: 'c@d.com', role: 'CUSTOMER', emailVerified: true })

const adminToken = () =>
  tokenFor({ id: 'a1', email: 'a@d.com', role: 'ADMIN', emailVerified: true })

const unverifiedToken = () =>
  tokenFor({ id: 'u1', email: 'c@d.com', role: 'CUSTOMER', emailVerified: false })

const baseOrder = (overrides = {}) => ({
  id: 'ord-1',
  userId: 'u1',
  status: 'PENDING',
  total: '50000',
  mpPreferenceId: null,
  items: [
    {
      id: 'item-1',
      productId: 'p1',
      quantity: 2,
      price: '25000',
      product: { id: 'p1', name: 'Camiseta', price: '25000', imageUrl: null },
    },
  ],
  ...overrides,
})

beforeEach(() => {
  mocks.prisma.order.findUnique.mockReset()
  mocks.prisma.order.update.mockReset()
  mocks.prisma.payment.upsert.mockReset()
  mocks.preferenceCreate.mockReset()
  mocks.paymentGet.mockReset()
  mocks.discountStock.mockReset().mockResolvedValue(undefined)
  mocks.restoreStock.mockReset().mockResolvedValue(undefined)
  mocks.sendOrderConfirmation.mockReset().mockResolvedValue(true)
  mocks.sendOrderCancelled.mockReset().mockResolvedValue(true)
  mocks.wompiGetPresignedAcceptance.mockReset()
  mocks.wompiCreateTransaction.mockReset()
})

// ─────────────────────────────────────────────────────────────
// POST /api/v1/payments/create-preference  (MercadoPago)
// ─────────────────────────────────────────────────────────────
describe('POST /api/v1/payments/create-preference — auth', () => {
  it('retorna 401 sin auth', async () => {
    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Origin', 'http://localhost:4321')
      .send({ orderId: 'ord-1', items: [{}], payer: { email: 'a@b.com' } })
    expect(res.status).toBe(401)
  })

  it('retorna 403 si el email no está verificado', async () => {
    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Authorization', `Bearer ${unverifiedToken()}`)
      .set('Origin', 'http://localhost:4321')
      .send({ orderId: 'ord-1', items: [{}], payer: { email: 'a@b.com' } })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED')
  })
})

describe('POST /api/v1/payments/create-preference — validación', () => {
  it('retorna 400 sin orderId', async () => {
    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Authorization', `Bearer ${customerToken()}`)
      .set('Origin', 'http://localhost:4321')
      .send({ items: [{}], payer: { email: 'a@b.com' } })
    expect(res.status).toBe(400)
  })

  it('retorna 400 sin items', async () => {
    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Authorization', `Bearer ${customerToken()}`)
      .set('Origin', 'http://localhost:4321')
      .send({ orderId: 'ord-1', payer: { email: 'a@b.com' } })
    expect(res.status).toBe(400)
  })

  it('retorna 400 sin payer.email', async () => {
    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Authorization', `Bearer ${customerToken()}`)
      .set('Origin', 'http://localhost:4321')
      .send({ orderId: 'ord-1', items: [{}] })
    expect(res.status).toBe(400)
  })

  it('retorna 404 si la orden no existe', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Authorization', `Bearer ${customerToken()}`)
      .set('Origin', 'http://localhost:4321')
      .send({ orderId: 'missing', items: [{}], payer: { email: 'a@b.com' } })
    expect(res.status).toBe(404)
  })

  it('retorna 400 si la orden no está PENDING', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder({ status: 'CONFIRMED' }))
    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Authorization', `Bearer ${customerToken()}`)
      .set('Origin', 'http://localhost:4321')
      .send({ orderId: 'ord-1', items: [{}], payer: { email: 'a@b.com' } })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/payments/create-preference — happy path', () => {
  it('crea preference, guarda mpPreferenceId y devuelve initPoint', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(baseOrder())
    mocks.prisma.order.update.mockResolvedValueOnce({ id: 'ord-1' })
    mocks.preferenceCreate.mockResolvedValueOnce({
      id: 'pref-123',
      init_point: 'https://mp.com/checkout',
      sandbox_init_point: 'https://sandbox.mp.com/checkout',
    })

    const res = await request(app)
      .post('/api/v1/payments/create-preference')
      .set('Authorization', `Bearer ${customerToken()}`)
      .set('Origin', 'http://localhost:4321')
      .send({
        orderId: 'ord-1',
        items: [{ productId: 'p1', quantity: 99, price: 9999 }], // cliente miente
        payer: { email: 'payer@x.com', name: 'Payer' },
      })

    expect(res.status).toBe(200)
    expect(res.body.preferenceId).toBe('pref-123')
    expect(res.body.initPoint).toBe('https://mp.com/checkout')

    // Items reconstruidos desde DB — precios/cantidades del cliente IGNORADOS
    const createArg = mocks.preferenceCreate.mock.calls[0][0].body
    expect(createArg.items[0].id).toBe('p1')
    expect(createArg.items[0].title).toBe('Camiseta')
    expect(createArg.items[0].unit_price).toBe(25000)
    expect(createArg.items[0].quantity).toBe(2)

    // mpPreferenceId guardado
    expect(mocks.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-1' },
        data: { mpPreferenceId: 'pref-123' },
      }),
    )
    expect(createArg.external_reference).toBe('ord-1')
    expect(createArg.notification_url).toContain('/api/payments/webhook')
  })
})

// ─────────────────────────────────────────────────────────────
// POST /api/v1/payments/webhook  (MercadoPago)
// ─────────────────────────────────────────────────────────────
const mpSignature = ({ ts, queryId, requestId, body, secret }) => {
  const manifest = `id:${queryId};request-id:${requestId};ts:${ts};`
  return {
    ts,
    v1: crypto.createHmac('sha256', secret).update(manifest).digest('hex'),
  }
}

const sendMpWebhook = async ({ ts, queryId, requestId, body, secret, queryIdOverride }) => {
  const sig = mpSignature({
    ts,
    queryId: queryIdOverride !== undefined ? queryIdOverride : (queryId ?? ''),
    requestId,
    body,
    secret: secret || process.env.MP_WEBHOOK_SECRET,
  })
  const path = `/api/v1/payments/webhook${queryIdOverride === undefined && queryId !== undefined ? `?id=${queryId}` : ''}`
  let req = request(app)
    .post(path)
    .set('x-signature', `ts=${sig.ts},v1=${sig.v1}`)
    .set('x-request-id', requestId)
    .set('Content-Type', 'application/json')

  return { req: req.send(body) }
}

describe('POST /api/v1/payments/webhook — verificación de firma', () => {
  it('retorna 401 sin header x-signature', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('x-request-id', 'req-1')
      .send({ type: 'payment' })
    expect(res.status).toBe(401)
  })

  it('retorna 401 sin header x-request-id', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('x-signature', 'ts=123,v1=abc')
      .send({ type: 'payment' })
    expect(res.status).toBe(401)
  })

  it('retorna 401 con formato de firma inválido (sin v1)', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('x-signature', 'ts=123')
      .set('x-request-id', 'req-1')
      .send({ type: 'payment' })
    expect(res.status).toBe(401)
  })

  it('retorna 401 con firma HMAC incorrecta', async () => {
    const body = JSON.stringify({ type: 'payment', data: { id: 'pay-1' } })
    const ts = String(Math.floor(Date.now() / 1000))
    const res = await request(app)
      .post('/api/v1/payments/webhook?id=q-1')
      .set('x-signature', `ts=${ts},v1=${'0'.repeat(64)}`)
      .set('x-request-id', 'req-1')
      .send(body)
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/payments/webhook — idempotencia', () => {
  const validHeaders = (body) => {
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = mpSignature({
      ts,
      queryId: 'q-1',
      requestId: 'req-1',
      body,
      secret: process.env.MP_WEBHOOK_SECRET,
    })
    return { 'x-signature': `ts=${sig.ts},v1=${sig.v1}`, 'x-request-id': 'req-1' }
  }

  it('retorna 200 sin tocar DB si type !== "payment"', async () => {
    const body = JSON.stringify({ type: 'plan', data: { id: 'plan-1' } })
    const res = await request(app)
      .post('/api/v1/payments/webhook?id=q-1')
      .set(validHeaders(body))
      .set('Content-Type', 'application/json')
      .send(body)
    expect(res.status).toBe(200)
    expect(mocks.paymentGet).not.toHaveBeenCalled()
    expect(mocks.prisma.order.update).not.toHaveBeenCalled()
  })

  it('retorna 200 sin tocar DB si falta data.id', async () => {
    const body = JSON.stringify({ type: 'payment' })
    const res = await request(app)
      .post('/api/v1/payments/webhook?id=q-1')
      .set(validHeaders(body))
      .set('Content-Type', 'application/json')
      .send(body)
    expect(res.status).toBe(200)
    expect(mocks.paymentGet).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/payments/webhook — flujo approved', () => {
  const sendApproved = async () => {
    const body = JSON.stringify({ type: 'payment', data: { id: 'pay-1' } })
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = mpSignature({
      ts, queryId: 'q-1', requestId: 'req-1', body,
      secret: process.env.MP_WEBHOOK_SECRET,
    })

    mocks.paymentGet.mockResolvedValueOnce({
      id: 'pay-1',
      status: 'approved',
      external_reference: 'ord-1',
      transaction_amount: 50000,
      currency_id: 'COP',
    })
    mocks.prisma.order.update.mockResolvedValueOnce({ id: 'ord-1', status: 'CONFIRMED' })
    mocks.prisma.payment.upsert.mockResolvedValueOnce({})

    return request(app)
      .post('/api/v1/payments/webhook?id=q-1')
      .set('x-signature', `ts=${sig.ts},v1=${sig.v1}`)
      .set('x-request-id', 'req-1')
      .set('Content-Type', 'application/json')
      .send(body)
  }

  it('marca orden CONFIRMED, descuenta stock y manda email', async () => {
    const res = await sendApproved()
    expect(res.status).toBe(200)

    expect(mocks.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-1' },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    )
    expect(mocks.discountStock).toHaveBeenCalledWith('ord-1')
    expect(mocks.sendOrderConfirmation).toHaveBeenCalledWith('ord-1')
  })

  it('crea/actualiza Payment con provider=MERCADOPAGO y status=COMPLETED', async () => {
    await sendApproved()
    expect(mocks.prisma.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'ord-1' },
        create: expect.objectContaining({
          provider: 'MERCADOPAGO',
          status: 'COMPLETED',
          amount: 50000,
          currency: 'COP',
        }),
      }),
    )
  })
})

describe('POST /api/v1/payments/webhook — flujo rejected / pending / error', () => {
  const sendWithStatus = async (mpStatus) => {
    const body = JSON.stringify({ type: 'payment', data: { id: 'pay-1' } })
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = mpSignature({
      ts, queryId: 'q-1', requestId: 'req-1', body,
      secret: process.env.MP_WEBHOOK_SECRET,
    })

    mocks.paymentGet.mockResolvedValueOnce({
      id: 'pay-1',
      status: mpStatus,
      external_reference: 'ord-1',
      transaction_amount: 50000,
      currency_id: 'COP',
    })
    mocks.prisma.order.update.mockResolvedValueOnce({})
    mocks.prisma.payment.upsert.mockResolvedValueOnce({})

    return request(app)
      .post('/api/v1/payments/webhook?id=q-1')
      .set('x-signature', `ts=${sig.ts},v1=${sig.v1}`)
      .set('x-request-id', 'req-1')
      .set('Content-Type', 'application/json')
      .send(body)
  }

  it('rejected → orden CANCELLED, NO descuenta stock, NO manda email', async () => {
    const res = await sendWithStatus('rejected')
    expect(res.status).toBe(200)
    expect(mocks.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    )
    expect(mocks.discountStock).not.toHaveBeenCalled()
    expect(mocks.sendOrderConfirmation).not.toHaveBeenCalled()
    expect(mocks.prisma.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'FAILED' }),
      }),
    )
  })

  it('pending → orden queda PENDING, sin descuento de stock', async () => {
    const res = await sendWithStatus('pending')
    expect(res.status).toBe(200)
    expect(mocks.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    )
    expect(mocks.discountStock).not.toHaveBeenCalled()
  })

  it('in_process → orden queda PENDING, sin descuento', async () => {
    const res = await sendWithStatus('in_process')
    expect(res.status).toBe(200)
    expect(mocks.discountStock).not.toHaveBeenCalled()
    expect(mocks.prisma.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'PENDING' }),
      }),
    )
  })

  it('status desconocido → fallback a PENDING', async () => {
    const res = await sendWithStatus('something-weird')
    expect(res.status).toBe(200)
    expect(mocks.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    )
  })

  it('retorna 200 incluso si la API de MP lanza error (evita reintentos)', async () => {
    const body = JSON.stringify({ type: 'payment', data: { id: 'pay-1' } })
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = mpSignature({
      ts, queryId: 'q-1', requestId: 'req-1', body,
      secret: process.env.MP_WEBHOOK_SECRET,
    })

    mocks.paymentGet.mockRejectedValueOnce(new Error('MP down'))

    const res = await request(app)
      .post('/api/v1/payments/webhook?id=q-1')
      .set('x-signature', `ts=${sig.ts},v1=${sig.v1}`)
      .set('x-request-id', 'req-1')
      .set('Content-Type', 'application/json')
      .send(body)
    expect(res.status).toBe(200)
    expect(mocks.prisma.order.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────
// POST /api/v1/payments/wompi/webhook
// ─────────────────────────────────────────────────────────────
const wompiSig = ({ id, ts, body }) =>
  crypto.createHmac('sha256', process.env.WOMPI_WEBHOOK_SECRET)
    .update(`${id}.${ts}.${body}`)
    .digest('hex')

const buildWompiRequest = (body, { skipSig = false, signatureOverride = null } = {}) => {
  const id = `evt-${Math.random().toString(36).slice(2)}`
  const ts = String(Date.now())
  const sig = signatureOverride || wompiSig({ id, ts, body })

  let req = request(app)
    .post('/api/v1/payments/wompi/webhook')
    .set('Content-Type', 'application/json')

  if (!skipSig) {
    req = req
      .set('x-wompi-event-id', id)
      .set('x-wompi-timestamp', ts)
      .set('x-wompi-signature', sig)
  }
  return req.send(body)
}

describe('POST /api/v1/payments/wompi/webhook — early returns y firma', () => {
  it('retorna 200 idempotente si event !== "transaction.updated"', async () => {
    const body = JSON.stringify({
      event: 'transaction.created',
      data: { object: { id: 't-1' } },
    })
    const res = await buildWompiRequest(body)
    expect(res.status).toBe(200)
    expect(mocks.prisma.order.update).not.toHaveBeenCalled()
  })

  it('retorna 401 sin headers de firma', async () => {
    const body = JSON.stringify({
      event: 'transaction.updated',
      data: { object: { id: 't-1', status: 'APPROVED' } },
    })
    const res = await buildWompiRequest(body, { skipSig: true })
    expect(res.status).toBe(401)
  })

  it('retorna 401 cuando longitudes de firma difieren', async () => {
    const body = JSON.stringify({
      event: 'transaction.updated',
      data: { object: { id: 't-1', status: 'APPROVED' } },
    })
    const res = await buildWompiRequest(body, { signatureOverride: 'short' })
    expect(res.status).toBe(401)
  })

  it('retorna 401 con firma HMAC incorrecta', async () => {
    const body = JSON.stringify({
      event: 'transaction.updated',
      data: { object: { id: 't-1', status: 'APPROVED' } },
    })
    const res = await buildWompiRequest(body, { signatureOverride: 'a'.repeat(64) })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/payments/wompi/webhook — flujo APPROVED / DECLINED', () => {
  it('APPROVED → orden CONFIRMED, descuento de stock y email', async () => {
    mocks.prisma.order.update.mockResolvedValueOnce({})
    mocks.prisma.payment.upsert.mockResolvedValueOnce({})

    const body = JSON.stringify({
      event: 'transaction.updated',
      data: {
        object: {
          id: 'wompi-tx-1',
          status: 'APPROVED',
          reference: 'ORDER-ord-42',
          amount_in_cents: 5000000,
          currency: 'COP',
        },
      },
    })
    const res = await buildWompiRequest(body)
    expect(res.status).toBe(200)

    expect(mocks.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-42' },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    )
    expect(mocks.discountStock).toHaveBeenCalledWith('ord-42')
    expect(mocks.sendOrderConfirmation).toHaveBeenCalledWith('ord-42')
    expect(mocks.prisma.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          provider: 'WOMPI',
          status: 'COMPLETED',
          amount: 50000,
        }),
      }),
    )
  })

  it('DECLINED → orden CANCELLED, NO descuenta stock', async () => {
    mocks.prisma.order.update.mockResolvedValueOnce({})
    mocks.prisma.payment.upsert.mockResolvedValueOnce({})

    const body = JSON.stringify({
      event: 'transaction.updated',
      data: {
        object: {
          id: 'wompi-tx-2',
          status: 'DECLINED',
          reference: 'ORDER-ord-99',
          amount_in_cents: 1000000,
          currency: 'COP',
        },
      },
    })
    const res = await buildWompiRequest(body)
    expect(res.status).toBe(200)

    expect(mocks.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    )
    expect(mocks.discountStock).not.toHaveBeenCalled()
    expect(mocks.sendOrderConfirmation).not.toHaveBeenCalled()
    expect(mocks.prisma.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'FAILED' }),
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────
// GET /api/v1/payments/status/:orderId
// ─────────────────────────────────────────────────────────────
describe('GET /api/v1/payments/status/:orderId', () => {
  it('retorna 401 sin auth', async () => {
    const res = await request(app).get('/api/v1/payments/status/ord-1')
    expect(res.status).toBe(401)
  })

  it('retorna 404 si la orden no existe', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .get('/api/v1/payments/status/missing')
      .set('Authorization', `Bearer ${customerToken()}`)
    expect(res.status).toBe(404)
  })

  it('retorna 403 si la orden pertenece a otro usuario', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce({
      id: 'ord-1', userId: 'otro', status: 'PENDING', paidAt: null, total: '50000',
    })
    const res = await request(app)
      .get('/api/v1/payments/status/ord-1')
      .set('Authorization', `Bearer ${customerToken()}`)
    expect(res.status).toBe(403)
  })

  it('retorna 200 para el dueño de la orden', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce({
      id: 'ord-1', userId: 'u1', status: 'CONFIRMED', paidAt: new Date(), total: '50000',
    })
    const res = await request(app)
      .get('/api/v1/payments/status/ord-1')
      .set('Authorization', `Bearer ${customerToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 'ord-1', status: 'CONFIRMED', total: '50000' })
  })

  it('ADMIN puede consultar orden de otro usuario', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce({
      id: 'ord-1', userId: 'u-otro', status: 'PENDING', paidAt: null, total: '9999',
    })
    const res = await request(app)
      .get('/api/v1/payments/status/ord-1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe('9999')
  })
})
