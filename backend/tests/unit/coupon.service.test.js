import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    coupon: {
      findFirst: vi.fn(),
    },
  },
}))

import { prisma } from '../../src/config/prisma.js'
import { validateCoupon } from '../../src/services/coupon.service.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const baseCoupon = (overrides = {}) => ({
  code: 'PROMO10',
  type: 'PERCENTAGE',
  value: '10',
  maxUses: null,
  usedCount: 0,
  minPurchase: null,
  ...overrides,
})

describe('validateCoupon', () => {
  it('normalizes code to uppercase before querying', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(baseCoupon())
    await validateCoupon('promo10', 1000)
    expect(prisma.coupon.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code: 'PROMO10' }),
      }),
    )
  })

  it('returns invalid when coupon does not exist', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(null)
    const result = await validateCoupon('NOPE', 1000)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Cupón no válido o expirado')
  })

  it('returns invalid when maxUses has been reached', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(
      baseCoupon({ maxUses: 5, usedCount: 5 }),
    )
    const result = await validateCoupon('PROMO10', 1000)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/límite de usos/)
  })

  it('returns invalid when subtotal is below minPurchase', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(
      baseCoupon({ minPurchase: '500' }),
    )
    const result = await validateCoupon('PROMO10', 100)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/mínimo/)
  })

  it('computes PERCENTAGE discount', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(
      baseCoupon({ type: 'PERCENTAGE', value: '10' }),
    )
    const result = await validateCoupon('PROMO10', 1000)
    expect(result.valid).toBe(true)
    expect(result.coupon.discount).toBe(100)
  })

  it('computes FIXED discount', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(
      baseCoupon({ type: 'FIXED', value: '250' }),
    )
    const result = await validateCoupon('PROMO10', 1000)
    expect(result.valid).toBe(true)
    expect(result.coupon.discount).toBe(250)
  })

  it('caps discount at subtotal (cannot exceed order total)', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(
      baseCoupon({ type: 'PERCENTAGE', value: '90' }),
    )
    const result = await validateCoupon('PROMO10', 100)
    expect(result.coupon.discount).toBe(90)
  })

  it('does not allow discount > subtotal when FIXED > subtotal', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(
      baseCoupon({ type: 'FIXED', value: '500' }),
    )
    const result = await validateCoupon('PROMO10', 100)
    expect(result.coupon.discount).toBe(100)
  })

  it('includes code, type, value in returned coupon', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(
      baseCoupon({ type: 'PERCENTAGE', value: '15' }),
    )
    const result = await validateCoupon('PROMO10', 1000)
    expect(result.coupon.code).toBe('PROMO10')
    expect(result.coupon.type).toBe('PERCENTAGE')
    expect(result.coupon.value).toBe('15')
  })

  it('passes endsAt OR-equals-null to Prisma (regression for service bug)', async () => {
    prisma.coupon.findFirst.mockResolvedValueOnce(baseCoupon())
    await validateCoupon('PROMO10', 1000)
    const call = prisma.coupon.findFirst.mock.calls[0][0]
    expect(call.where.AND).toEqual([
      {
        OR: [
          { endsAt: expect.any(Object) },
          { endsAt: null },
        ],
      },
    ])
  })
})