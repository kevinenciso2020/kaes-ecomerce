import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    user:       { count: vi.fn() },
    product:    { count: vi.fn(), findMany: vi.fn() },
    order:      { count: vi.fn(), findMany: vi.fn(), aggregate: vi.fn() },
    orderItem:  { findMany: vi.fn(), groupBy: vi.fn() },
    $queryRaw:  vi.fn(),
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

describe('GET /api/v1/admin/dashboard/overview', () => {
  it('returns the 4-card overview shape', async () => {
    prisma.user.count.mockResolvedValueOnce(100)            // totalUsers
    prisma.product.count.mockResolvedValueOnce(20)           // totalProducts
    // order.count se llama 3 veces en orden: totalOrders → todayOrders → paidOrdersCount
    prisma.order.count
      .mockResolvedValueOnce(500)                            // totalOrders
      .mockResolvedValueOnce(10)                             // todayOrders
      .mockResolvedValueOnce(400)                            // paidOrdersCount (for avgTicket)
    prisma.order.aggregate
      .mockResolvedValueOnce({ _sum: { total: 1000000 } })   // revenue
      .mockResolvedValueOnce({ _sum: { total: 50000 } })     // todayRevenue

    const res = await request(app)
      .get('/api/v1/admin/dashboard/overview')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      totalUsers:    100,
      totalProducts: 20,
      totalOrders:   500,
      revenue:       1000000,
      todayRevenue:  50000,
      todayOrders:   10,
    })
    expect(res.body.avgTicket).toBe(2500) // 1_000_000 / 400
  })

  it('handles zero revenue gracefully', async () => {
    prisma.user.count.mockResolvedValueOnce(0)
    prisma.product.count.mockResolvedValueOnce(0)
    prisma.order.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    prisma.order.aggregate
      .mockResolvedValueOnce({ _sum: { total: null } })
      .mockResolvedValueOnce({ _sum: { total: null } })

    const res = await request(app)
      .get('/api/v1/admin/dashboard/overview')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.revenue).toBe(0)
    expect(res.body.avgTicket).toBe(0)
  })

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard/overview')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/admin/dashboard/sales', () => {
  it('rejects invalid range', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard/sales?range=infinite')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('returns filled series for 7d range', async () => {
    const today = new Date()
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    prisma.$queryRaw.mockResolvedValueOnce([
      { bucket: yesterday, ordercount: 5, revenue: 250000 },
      { bucket: today,     ordercount: 3, revenue: 150000 },
    ])

    const res = await request(app)
      .get('/api/v1/admin/dashboard/sales?range=7d')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.range).toBe('7d')
    expect(res.body.bucket).toBe('day')
    expect(res.body.series.length).toBe(8) // 7d + today
    // Asegurar que rellena con 0 los días sin ventas
    expect(res.body.series.every((d) => typeof d.revenue === 'number')).toBe(true)
  })

  it('returns monthly buckets for 12m range', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    const res = await request(app)
      .get('/api/v1/admin/dashboard/sales?range=12m')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.bucket).toBe('month')
  })
})

describe('GET /api/v1/admin/dashboard/top-products', () => {
  it('returns top N products with sold units', async () => {
    prisma.orderItem.groupBy.mockResolvedValueOnce([
      { productId: 'p1', _sum: { quantity: 50 } },
      { productId: 'p2', _sum: { quantity: 30 } },
    ])
    prisma.product.findMany.mockResolvedValueOnce([
      { id: 'p1', name: 'Camiseta', slug: 'c', images: [], category: { name: 'Camisetas' } },
      { id: 'p2', name: 'Pantalon', slug: 'p', images: [], category: { name: 'Pantalones' } },
    ])

    const res = await request(app)
      .get('/api/v1/admin/dashboard/top-products?limit=10&range=30d')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.products).toHaveLength(2)
    expect(res.body.products[0]).toMatchObject({ id: 'p1', sold: 50 })
  })

  it('returns empty array when no orders', async () => {
    prisma.orderItem.groupBy.mockResolvedValueOnce([])
    const res = await request(app)
      .get('/api/v1/admin/dashboard/top-products')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.products).toEqual([])
  })

  it('rejects limit > 50', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard/top-products?limit=999')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/admin/dashboard/by-category', () => {
  it('aggregates revenue by category', async () => {
    prisma.orderItem.findMany.mockResolvedValueOnce([
      {
        quantity: 2, price: { toString: () => '50000' },
        product: { categoryId: 'cat1', category: { name: 'Camisetas', slug: 'camisetas' } },
      },
      {
        quantity: 1, price: { toString: () => '100000' },
        product: { categoryId: 'cat2', category: { name: 'Pantalones', slug: 'pantalones' } },
      },
    ])

    const res = await request(app)
      .get('/api/v1/admin/dashboard/by-category')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.categories.length).toBeGreaterThan(0)
    // categorías ordenadas por revenue desc
    const cats = res.body.categories
    expect(cats[0].revenue).toBeGreaterThanOrEqual(cats[cats.length - 1].revenue)
  })
})

describe('GET /api/v1/admin/dashboard/recent-orders', () => {
  it('returns up to N recent orders', async () => {
    prisma.order.findMany.mockResolvedValueOnce([
      { id: 'o1', total: 50000, status: 'PENDING', user: { name: 'A', email: 'a@x.com' } },
    ])
    const res = await request(app)
      .get('/api/v1/admin/dashboard/recent-orders?limit=5')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.orders).toHaveLength(1)
  })

  it('rejects limit > 50', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard/recent-orders?limit=999')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/admin/dashboard/low-stock', () => {
  it('filters products whose variants are below threshold', async () => {
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: 'p1', name: 'Camiseta', lowStockThreshold: 5,
        variants: [
          { stock: 2, lowStockThreshold: 5, size: 'M', color: 'Negro' },
          { stock: 1, lowStockThreshold: 5, size: 'L', color: 'Negro' },
        ],
        images: [],
      },
      {
        id: 'p2', name: 'Pantalon', lowStockThreshold: 5,
        variants: [
          { stock: 10, lowStockThreshold: 5, size: '30', color: 'Azul' },
        ],
        images: [],
      },
    ])

    const res = await request(app)
      .get('/api/v1/admin/dashboard/low-stock')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.products).toHaveLength(1)
    expect(res.body.products[0].id).toBe('p1')
    expect(res.body.products[0].lowVariants).toHaveLength(2)
  })
})
