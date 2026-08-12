import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    cartItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    product: { findUnique: vi.fn() },
    coupon: { findFirst: vi.fn() },
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

describe('Cart routes — all require auth', () => {
  const routes = [
    { method: 'get',    path: '/api/v1/cart/' },
    { method: 'post',   path: '/api/v1/cart/' },
    { method: 'put',    path: '/api/v1/cart/item-1' },
    { method: 'delete', path: '/api/v1/cart/item-1' },
    { method: 'delete', path: '/api/v1/cart/' },
  ]

  for (const r of routes) {
    it(`${r.method.toUpperCase()} ${r.path} → 401 without auth`, async () => {
      const res = await request(app)[r.method](r.path)
      expect(res.status).toBe(401)
    })
  }

  it('authed request reaches handler', async () => {
    const token = tokenFor({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' })
    const res = await request(app)
      .get('/api/v1/cart/')
      .set('Authorization', `Bearer ${token}`)
    expect([200, 500]).toContain(res.status)
  })
})