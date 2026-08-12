import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    order: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    orderItem: { create: vi.fn() },
    cartItem: { findMany: vi.fn(), deleteMany: vi.fn() },
    product: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    coupon: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

import request from 'supertest'
import app from '../../src/app.js'

const tokenFor = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Order routes — all require auth', () => {
  it('GET / → 401 without auth', async () => {
    const res = await request(app).get('/api/v1/orders/')
    expect(res.status).toBe(401)
  })

  it('POST / → 401 without auth', async () => {
    const res = await request(app).post('/api/v1/orders/').send({})
    expect(res.status).toBe(401)
  })

  it('GET /:id → 401 without auth', async () => {
    const res = await request(app).get('/api/v1/orders/order-1')
    expect(res.status).toBe(401)
  })

  it('authed GET / reaches handler', async () => {
    const token = tokenFor({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' })
    const res = await request(app)
      .get('/api/v1/orders/')
      .set('Authorization', `Bearer ${token}`)
    expect([200, 500]).toContain(res.status)
  })
})