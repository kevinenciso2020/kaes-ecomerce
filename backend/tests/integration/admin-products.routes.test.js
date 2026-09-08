import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    product: {
      findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
    },
    productImage: {
      findFirst: vi.fn(), findMany: vi.fn(),
      create: vi.fn(), createMany: vi.fn(),
      update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(),
    },
    productVariant: {
      findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(),
      createMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(), create: vi.fn(),
    },
    productAvailableSize: { deleteMany: vi.fn(), createMany: vi.fn() },
    category: { findUnique: vi.fn(), findMany: vi.fn() },
    color: { findMany: vi.fn(), findUnique: vi.fn() },
    size: { findMany: vi.fn(), findUnique: vi.fn() },
    orderItem: { count: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}))

vi.mock('../../src/config/cloudinary.js', () => ({
  default: {
    uploader: {
      upload:  vi.fn(),
      destroy: vi.fn(),
    },
  },
}))

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

import request from 'supertest'
import app from '../../src/app.js'
import { prisma } from '../../src/config/prisma.js'
import cloudinary from '../../src/config/cloudinary.js'

const adminToken = () =>
  jwt.sign({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '15m' })

beforeEach(() => {
  // resetAllMocks borra calls, results, queue de mockResolvedValueOnce
  // y deja las implementaciones persistentes (mockResolvedValue, mockReturnValue) intactas.
  vi.resetAllMocks()
  cloudinary.uploader.upload.mockResolvedValue({ secure_url: 'https://x/y.jpg', public_id: 'pid' })
  cloudinary.uploader.destroy.mockResolvedValue({ result: 'ok' })
})

describe('GET /api/v1/admin/colors', () => {
  it('returns the canonical color list', async () => {
    prisma.color.findMany.mockResolvedValueOnce([
      { id: 'c1', name: 'Negro', slug: 'negro', hex: '#000', order: 1 },
      { id: 'c2', name: 'Blanco', slug: 'blanco', hex: '#FFF', order: 2 },
    ])
    const res = await request(app)
      .get('/api/v1/admin/colors')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toMatchObject({ slug: 'negro' })
  })

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/colors')
    expect(res.status).toBe(401)
  })

  it('returns 403 for CUSTOMER role', async () => {
    const token = jwt.sign({ id: 'u1', role: 'CUSTOMER' }, process.env.JWT_SECRET)
    const res = await request(app).get('/api/v1/admin/colors').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/admin/sizes', () => {
  it('returns sizes filtered by scale when ?scale=LETTER', async () => {
    prisma.size.findMany.mockResolvedValueOnce([
      { id: 's1', value: 'M', scale: 'LETTER', order: 3 },
    ])
    const res = await request(app)
      .get('/api/v1/admin/sizes?scale=LETTER')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(prisma.size.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scale: 'LETTER' } }),
    )
  })

  it('rejects invalid scale', async () => {
    const res = await request(app)
      .get('/api/v1/admin/sizes?scale=BOGUS')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/admin/products (admin list)', () => {
  it('returns products with pagination shape', async () => {
    prisma.product.findMany.mockResolvedValueOnce([
      { id: 'p1', name: 'X', slug: 'x', price: 100, stock: 5, lowStockThreshold: 5,
        isActive: true, isFeatured: false, variants: [{ stock: 1, lowStockThreshold: 5 }] },
    ])
    prisma.product.count.mockResolvedValueOnce(1)

    const res = await request(app)
      .get('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      products: expect.any(Array),
      total: 1,
      page: 1,
      totalPages: 1,
    })
    expect(res.body.products[0]).toMatchObject({
      id: 'p1',
      totalStock: 1,
      lowStockCount: 1,
    })
  })

  it('rejects invalid isActive value', async () => {
    const res = await request(app)
      .get('/api/v1/admin/products?isActive=bogus')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('returns 403 for non-admin', async () => {
    const token = jwt.sign({ id: 'u1', role: 'CUSTOMER' }, process.env.JWT_SECRET)
    const res = await request(app)
      .get('/api/v1/admin/products')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/admin/products/:id', () => {
  it('returns the product with full includes', async () => {
    prisma.product.findUnique.mockResolvedValueOnce({
      id: 'p1', name: 'X', slug: 'x', price: 100,
      category: { id: 'cat1', name: 'Cat' },
      images: [], variants: [], availableSizes: [],
      discounts: [],
    })

    const res = await request(app)
      .get('/api/v1/admin/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('p1')
  })

  it('returns 404 when not found', async () => {
    prisma.product.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .get('/api/v1/admin/products/ghost')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/admin/products/:id/images/:imageId', () => {
  it('deletes an image and calls cloudinary.destroy', async () => {
    prisma.productImage.findFirst.mockResolvedValueOnce({
      id: 'img1', publicId: 'pid1', isMain: false, productId: 'p1',
    })
    prisma.productImage.delete.mockResolvedValueOnce({ id: 'img1' })
    prisma.productImage.findFirst.mockResolvedValueOnce(null)

    const res = await request(app)
      .delete('/api/v1/admin/products/p1/images/img1')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ deleted: true, imageId: 'img1' })
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('pid1')
  })

  it('returns 404 when image does not belong to product', async () => {
    prisma.productImage.findFirst.mockResolvedValueOnce(null)
    const res = await request(app)
      .delete('/api/v1/admin/products/p1/images/img-ghost')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/admin/products/:id/images/:imageId/main', () => {
  it('marks the image as main within a transaction', async () => {
    prisma.productImage.findFirst.mockResolvedValueOnce({
      id: 'img2', productId: 'p1', isMain: false,
    })
    prisma.$transaction.mockResolvedValueOnce([{ count: 3 }, { id: 'img2' }])
    prisma.product.findUnique.mockResolvedValueOnce({
      id: 'p1', name: 'X', variants: [], images: [], category: null, availableSizes: [], discounts: [],
    })

    const res = await request(app)
      .patch('/api/v1/admin/products/p1/images/img2/main')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/admin/products/:id (soft delete)', () => {
  it('sets isActive=false and destroys Cloudinary images', async () => {
    prisma.product.findUnique.mockResolvedValueOnce({
      id: 'p1', isActive: true,
      images: [
        { id: 'i1', publicId: 'pid1' },
        { id: 'i2', publicId: 'pid2' },
      ],
    })
    prisma.product.update.mockResolvedValueOnce({ id: 'p1', isActive: false })

    const res = await request(app)
      .delete('/api/v1/admin/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 'p1', softDeleted: true })
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isActive: false },
    })
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('pid1')
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('pid2')
  })

  it('returns 404 when product does not exist', async () => {
    prisma.product.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .delete('/api/v1/admin/products/ghost')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })
})

describe('Validation guards on product payloads', () => {
  it('POST /products rejects empty name', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ price: 100, categorySlug: 'camisetas' })
    expect(res.status).toBe(400)
    expect(res.body.errors.some((e) => e.field === 'name')).toBe(true)
  })

  it('POST /products rejects missing category', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Test', price: 100 })
    expect(res.status).toBe(400)
  })

  it('POST /products rejects invalid variants JSON', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Test', price: 100, categorySlug: 'camisetas', variants: 'not-json' })
    expect(res.status).toBe(400)
  })

  it('POST /products rejects negative price', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Test', price: -10, categorySlug: 'camisetas' })
    expect(res.status).toBe(400)
  })
})
