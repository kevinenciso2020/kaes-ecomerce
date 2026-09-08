import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
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

import request from 'supertest'
import app from '../../src/app.js'
import { prisma } from '../../src/config/prisma.js'

const adminToken = () =>
  jwt.sign({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '15m' })

beforeEach(() => {
  vi.resetAllMocks()
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
  it('changes status, writes OrderStatusLog, returns updated order', async () => {
    prisma.$transaction.mockImplementationOnce(async (cb) => {
      const tx = {
        order: {
          // findUnique se llama 2 veces en el flujo normal:
          // 1) leer order original → 2) leer order final con includes
          findUnique: vi.fn()
            .mockResolvedValueOnce(makeOrder({ status: 'PENDING' }))
            .mockResolvedValueOnce(makeOrder({ status: 'CONFIRMED' })),
          update:     vi.fn().mockResolvedValueOnce(makeOrder({ status: 'CONFIRMED' })),
          findFirst:  vi.fn(),
        },
        orderStatusLog: { create: vi.fn().mockResolvedValueOnce({ id: 'log1' }) },
        orderItem:      { findMany: vi.fn() },
        product:        { update: vi.fn() },
        productVariant: { findFirst: vi.fn(), update: vi.fn() },
      }
      return cb(tx)
    })

    const res = await request(app)
      .put('/api/v1/admin/orders/o1/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'CONFIRMED', note: 'Pago verificado' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
  })

  it('does not write log when status does not change', async () => {
    const orderSame = makeOrder({ status: 'PENDING' })
    prisma.$transaction.mockImplementationOnce(async (cb) => {
      const tx = {
        order: {
          // 1) leer order → 2) leer order final con includes
          findUnique: vi.fn()
            .mockResolvedValueOnce(orderSame)
            .mockResolvedValueOnce(orderSame),
          update:    vi.fn(),
          findFirst: vi.fn(),
        },
        orderStatusLog: { create: vi.fn() },
      }
      return cb(tx)
    })

    const res = await request(app)
      .put('/api/v1/admin/orders/o1/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'PENDING' })

    expect(res.status).toBe(200)
  })

  it('rejects invalid status value', async () => {
    const res = await request(app)
      .put('/api/v1/admin/orders/o1/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'MAYBE' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when order does not exist', async () => {
    prisma.$transaction.mockImplementationOnce(async (cb) => {
      const tx = {
        order: { findUnique: vi.fn().mockResolvedValueOnce(null) },
      }
      return cb(tx)
    })

    const res = await request(app)
      .put('/api/v1/admin/orders/ghost/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'CONFIRMED' })
    expect(res.status).toBe(404)
  })

  it('restores stock when transitioning to CANCELLED from PENDING', async () => {
    const orderWithItems = makeOrder({
      status: 'PENDING',
      items: [
        { id: 'oi1', productId: 'p1', quantity: 2, size: 'M', color: 'Negro' },
      ],
    })
    const variant = { id: 'v1', stock: 8 }

    prisma.$transaction.mockImplementationOnce(async (cb) => {
      const tx = {
        order: {
          findUnique: vi.fn()
            .mockResolvedValueOnce(orderWithItems)
            .mockResolvedValueOnce(makeOrder({ status: 'CANCELLED' })),
          update:    vi.fn().mockResolvedValueOnce(makeOrder({ status: 'CANCELLED' })),
          findFirst: vi.fn(),
        },
        orderItem: { findMany: vi.fn().mockResolvedValueOnce(orderWithItems.items) },
        productVariant: {
          findFirst: vi.fn().mockResolvedValueOnce(variant),
          update:    vi.fn().mockResolvedValueOnce({ ...variant, stock: 10 }),
        },
        product: { update: vi.fn() },
        orderStatusLog: { create: vi.fn().mockResolvedValueOnce({ id: 'log1' }) },
      }
      return cb(tx)
    })

    const res = await request(app)
      .put('/api/v1/admin/orders/o1/status')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ status: 'CANCELLED' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CANCELLED')
  })
})
