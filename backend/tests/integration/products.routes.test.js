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

describe('Rutas de escritura públicas eliminadas', () => {
  // Antes existían POST/PUT/DELETE /products que colgaban la petición
  // (validate mal invocado). La gestión vive en /api/v1/admin/products.
  it('POST /api/v1/products → 404', async () => {
    const token = tokenFor({ id: 'a1', email: 'a@d.com', role: 'ADMIN' })
    const res = await request(app).post('/api/v1/products').set('Authorization', `Bearer ${token}`).send({})
    expect(res.status).toBe(404)
  })

  it('POST /api/v1/admin/products → 401 sin auth y 403 para CUSTOMER', async () => {
    expect((await request(app).post('/api/v1/admin/products').send({})).status).toBe(401)
    const token = tokenFor({ id: 'u1', email: 'c@d.com', role: 'CUSTOMER' })
    const res = await request(app).post('/api/v1/admin/products').set('Authorization', `Bearer ${token}`).send({})
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/products — límites', () => {
  it('limita el tamaño de página a 48', async () => {
    prisma.product.findMany.mockResolvedValueOnce([])
    prisma.product.count.mockResolvedValueOnce(0)
    await request(app).get('/api/v1/products?limit=100000')
    expect(prisma.product.findMany.mock.calls[0][0].take).toBe(48)
  })
})

describe('GET /api/v1/products/categories (public)', () => {
  it('returns categories list without auth', async () => {
    prisma.category.findMany.mockResolvedValueOnce([])
    const res = await request(app).get('/api/v1/products/categories')
    expect(res.status).toBe(200)
  })
})