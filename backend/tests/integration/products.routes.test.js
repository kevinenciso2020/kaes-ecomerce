import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    product: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    category: { findMany: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

import request from 'supertest'
import { prisma } from '../../src/config/prisma.js'
import app from '../../src/app.js'

const tokenFor = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/products (public)', () => {
  it('returns products list without auth', async () => {
    prisma.product.findMany.mockResolvedValueOnce([])
    prisma.product.count.mockResolvedValueOnce(0)
    const res = await request(app).get('/api/v1/products')
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/products (admin-only)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/v1/products').send({})
    expect(res.status).toBe(401)
  })

  it('returns 403 for CUSTOMER role', async () => {
    const token = tokenFor({ id: 'u1', email: 'c@d.com', role: 'CUSTOMER' })
    const res = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/products/categories (public)', () => {
  it('returns categories list without auth', async () => {
    prisma.category.findMany.mockResolvedValueOnce([])
    const res = await request(app).get('/api/v1/products/categories')
    expect(res.status).toBe(200)
  })
})