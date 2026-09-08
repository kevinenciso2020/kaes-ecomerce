import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    color: { findMany: vi.fn() },
    size:  { findMany: vi.fn() },
  },
}))

import request from 'supertest'
import app from '../../src/app.js'
import { prisma } from '../../src/config/prisma.js'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /api/v1/colors (public catalog)', () => {
  it('returns the canonical color list without auth', async () => {
    prisma.color.findMany.mockResolvedValueOnce([
      { id: 'c1', name: 'Negro',  slug: 'negro',  hex: '#000000', order: 1 },
      { id: 'c2', name: 'Blanco', slug: 'blanco', hex: '#FFFFFF', order: 2 },
    ])

    const res = await request(app).get('/api/v1/colors')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toMatchObject({ slug: 'negro', hex: '#000000' })
  })

  it('orders by the `order` field then by name', async () => {
    prisma.color.findMany.mockResolvedValueOnce([])
    await request(app).get('/api/v1/colors')
    expect(prisma.color.findMany).toHaveBeenCalledWith({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    })
  })

  it('returns 200 even with no colors in DB', async () => {
    prisma.color.findMany.mockResolvedValueOnce([])
    const res = await request(app).get('/api/v1/colors')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('GET /api/v1/sizes (public catalog)', () => {
  it('returns the full size list when no scale filter', async () => {
    prisma.size.findMany.mockResolvedValueOnce([
      { id: 's1', value: 'M', scale: 'LETTER',  order: 3 },
      { id: 's2', value: '32', scale: 'NUMERIC', order: 3 },
      { id: 's3', value: '38', scale: 'SHOE',    order: 4 },
    ])

    const res = await request(app).get('/api/v1/sizes')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
  })

  it('filters by scale when ?scale=LETTER', async () => {
    prisma.size.findMany.mockResolvedValueOnce([
      { id: 's1', value: 'M', scale: 'LETTER', order: 3 },
    ])

    const res = await request(app).get('/api/v1/sizes?scale=LETTER')
    expect(res.status).toBe(200)
    expect(prisma.size.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scale: 'LETTER' } }),
    )
  })

  it('rejects invalid scale with 400', async () => {
    const res = await request(app).get('/api/v1/sizes?scale=BOGUS')
    expect(res.status).toBe(400)
  })

  it('does NOT require authentication (public endpoint)', async () => {
    prisma.size.findMany.mockResolvedValueOnce([])
    const res = await request(app).get('/api/v1/sizes')
    // Si pidiera auth, sería 401
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})

describe('Public catalog endpoints are NOT blocked by admin middleware', () => {
  it('catalog endpoints work while admin endpoints return 401', async () => {
    prisma.color.findMany.mockResolvedValueOnce([])
    prisma.size.findMany.mockResolvedValueOnce([])

    const [colors, sizes, adminColors] = await Promise.all([
      request(app).get('/api/v1/colors'),
      request(app).get('/api/v1/sizes'),
      request(app).get('/api/v1/admin/colors'),
    ])

    expect(colors.status).toBe(200)
    expect(sizes.status).toBe(200)
    expect(adminColors.status).toBe(401)
  })
})
