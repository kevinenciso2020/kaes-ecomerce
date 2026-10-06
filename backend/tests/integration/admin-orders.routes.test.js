import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    order: {
      findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(),
      update: vi.fn(), count: vi.fn(), create: vi.fn(),
    },
    orderItem: { findMany: vi.fn(), update: vi.fn() },
    product:   { update: vi.fn(), findFirst: vi.fn() },
    productVariant: { findFirst: vi.fn(), update: vi.fn() },
    orderStatusLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../../src/services/email.service.js', () => ({
  sendOrderCancelled: vi.fn().mockResolvedValue(true),
}))

import request from 'supertest'
import { sendOrderCancelled } from '../../src/services/email.service.js'
import app from '../../src/app.js'
import { prisma } from '../../src/config/prisma.js'

const adminToken = () =>
  jwt.sign({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '15m' })

beforeEach(() => {
  vi.resetAllMocks()
  // isAdmin confirma en BD que el admin sigue activo y con el mismo rol.
  prisma.user.findFirst.mockResolvedValue({ id: 'admin' })
})

const makeOrder = (overrides = {}) => ({
  id: 'o1', userId: 'u1', status: 'PENDING',
  subtotal: 100, discount: 0, shipping: 0, total: 100,
  user: { id: 'u1', name: 'John', email: 'j@d.com', phone: '123' },
  items: [],
  payment: null,
  shippingAddress: null,
  statusLogs: [],
  createdAt: new Date('2026-09-01').toISOString(),
  updatedAt: new Date('2026-09-01').toISOString(),
  ...overrides,
})

describe('GET /api/v1/admin/orders', () => {
  it('returns paginated orders', async () => {
    prisma.order.findMany.mockResolvedValueOnce([makeOrder()])
    prisma.order.count.mockResolvedValueOnce(1)

    const res = await request(app)
      .get('/api/v1/admin/orders')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ orders: expect.any(Array), total: 1, page: 1 })
    expect(res.body.orders[0].statusLogs).toEqual([])
  })

  it('rejects invalid status filter', async () => {
    const res = await request(app)
      .get('/api/v1/admin/orders?status=NOPE')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('accepts dateFrom/dateTo ISO strings', async () => {
    prisma.order.findMany.mockResolvedValueOnce([])
    prisma.order.count.mockResolvedValueOnce(0)

    const res = await request(app)
      .get('/api/v1/admin/orders?dateFrom=2026-09-01T00:00:00Z&dateTo=2026-09-30T23:59:59Z')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    // Verificar que se construyó el where con rango de fecha
    const call = prisma.order.findMany.mock.calls[0][0]
    expect(call.where.createdAt).toBeDefined()
  })

  it('rejects non-ISO dateFrom', async () => {
    const res = await request(app)
      .get('/api/v1/admin/orders?dateFrom=yesterday')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('accepts search by user email', async () => {
    prisma.order.findMany.mockResolvedValueOnce([])
    prisma.order.count.mockResolvedValueOnce(0)
    const res = await request(app)
      .get('/api/v1/admin/orders?search=john@example.com')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
  })
})

describe('GET /api/v1/admin/orders/:id', () => {
  it('returns full order with statusLogs', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(makeOrder({
      statusLogs: [
        { id: 'l1', fromStatus: null, toStatus: 'PENDING', createdAt: new Date(), changedBy: null },
      ],
    }))
    const res = await request(app)
      .get('/api/v1/admin/orders/o1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.statusLogs).toHaveLength(1)
  })

  it('returns 404 for missing order', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .get('/api/v1/admin/orders/ghost')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/v1/admin/orders/:id/status', () => {
  // tx simulado: la orden bloqueada y los modelos que usa la transición
  const setupTx = (order) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(order ? [{ id: order.id }] : []),
      order: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(order)
          .mockResolvedValue({ ...order, statusLogs: [] }),
        update: vi.fn().mockResolvedValue({}),
      },
      orderStatusLog: { create: vi.fn().mockResolvedValue({}) },
      product: { update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      productVariant: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }
    prisma.$transaction.mockImplementation(async (cb) => cb(tx))
    return tx
  }

  const put = (body, id = 'o1') =>
    request(app).put(`/api/v1/admin/orders/${id}/status`).set('Authorization', `Bearer ${adminToken()}`).send(body)

  it('CONFIRMED → SHIPPED escribe OrderStatusLog con autor y nota', async () => {
    const tx = setupTx(makeOrder({ status: 'CONFIRMED', stockDeducted: true, items: [] }))
    const res = await put({ status: 'SHIPPED', note: 'Guía 123' })
    expect(res.status).toBe(200)
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'SHIPPED' } })
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith({
      data: { orderId: 'o1', fromStatus: 'CONFIRMED', toStatus: 'SHIPPED', changedById: 'a1', note: 'Guía 123' },
    })
  })

  it('no escribe log si el estado no cambia', async () => {
    const tx = setupTx(makeOrder({ status: 'SHIPPED' }))
    const res = await put({ status: 'SHIPPED' })
    expect(res.status).toBe(200)
    expect(tx.orderStatusLog.create).not.toHaveBeenCalled()
  })

  it('rechaza un estado inválido', async () => {
    const res = await put({ status: 'NOPE' })
    expect(res.status).toBe(400)
  })

  it('404 si la orden no existe', async () => {
    setupTx(null)
    const res = await put({ status: 'CANCELLED' }, 'missing')
    expect(res.status).toBe(404)
  })

  it('409 en transiciones no permitidas (DELIVERED → PENDING)', async () => {
    setupTx(makeOrder({ status: 'DELIVERED' }))
    const res = await put({ status: 'PENDING' })
    expect(res.status).toBe(409)
  })

  it('cancelar una orden PENDING (sin pago) NO devuelve stock que nunca se descontó', async () => {
    const tx = setupTx(makeOrder({
      status: 'PENDING', stockDeducted: false,
      items: [{ productId: 'p1', quantity: 2, size: null, color: null, variantId: null }],
    }))
    const res = await put({ status: 'CANCELLED' })
    expect(res.status).toBe(200)
    expect(tx.product.update).not.toHaveBeenCalled()
    expect(tx.productVariant.update).not.toHaveBeenCalled()
  })

  it('cancelar una orden pagada (stockDeducted) devuelve el stock', async () => {
    const tx = setupTx(makeOrder({
      status: 'CONFIRMED', stockDeducted: true,
      items: [{ productId: 'p1', quantity: 2, size: null, color: null, variantId: null }],
    }))
    const res = await put({ status: 'CANCELLED' })
    expect(res.status).toBe(200)
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { stock: { increment: 2 } } })
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' }, data: { status: 'CANCELLED', stockDeducted: false, needsReview: false },
    })
    expect(sendOrderCancelled).toHaveBeenCalledWith('o1')
  })

  it('confirmar manualmente una orden PENDING descuenta stock (409 si no alcanza)', async () => {
    const tx = setupTx(makeOrder({
      status: 'PENDING', stockDeducted: false,
      items: [{ productId: 'p1', quantity: 2, size: null, color: null, variantId: null }],
    }))
    tx.product.updateMany.mockResolvedValueOnce({ count: 0 })
    const res = await put({ status: 'CONFIRMED' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('INSUFFICIENT_STOCK')
  })
})
