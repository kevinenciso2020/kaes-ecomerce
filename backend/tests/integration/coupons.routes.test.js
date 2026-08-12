import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    coupon: { findFirst: vi.fn() },
  },
}))

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

import request from 'supertest'
import { prisma } from '../../src/config/prisma.js'
import app from '../../src/app.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/coupons/:code (public)', () => {
  it('returns 400 with invalid coupon', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(null)
    const res = await request(app).get('/api/v1/coupons/NOPE')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Cupón no válido o expirado')
  })

  it('returns 200 with coupon details for valid code', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce({
      code: 'PROMO10',
      type: 'PERCENTAGE',
      value: '10',
      maxUses: null,
      usedCount: 0,
      minPurchase: null,
    })
    const res = await request(app)
      .get('/api/v1/coupons/PROMO10')
      .query({ subtotal: 1000 })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ code: 'PROMO10', discount: 100 })
  })

  it('normalizes code to uppercase', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(null)
    await request(app).get('/api/v1/coupons/promo10')
    expect(prisma.coupon.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ code: 'PROMO10' }) }),
    )
  })
})