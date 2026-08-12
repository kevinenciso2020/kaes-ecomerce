import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let couponStoreModule

const loadFresh = async () => {
  vi.resetModules()
  couponStoreModule = await import('../src/stores/coupon.store.js')
}

beforeEach(async () => {
  window.localStorage.clear()
  await loadFresh()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('coupon.store — applyCoupon', () => {
  it('uppercases the code and sets the atom', () => {
    const coupon = couponStoreModule.applyCoupon('summer10', { type: 'PERCENTAGE', value: 10 })
    expect(coupon.code).toBe('SUMMER10')
    expect(couponStoreModule.appliedCoupon.get()).toBe(coupon)
    expect(couponStoreModule.appliedCoupon.get().discount).toEqual({ type: 'PERCENTAGE', value: 10 })
  })

  it('persists to localStorage', () => {
    couponStoreModule.applyCoupon('SUMMER10')
    const raw = window.localStorage.getItem('appliedCoupon')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw)
    expect(parsed.code).toBe('SUMMER10')
    expect(parsed.expiresAt).toBeTruthy()
  })

  it('sets expiresAt ~30 days in the future', () => {
    const before = Date.now()
    const coupon = couponStoreModule.applyCoupon('X')
    const expires = new Date(coupon.expiresAt).getTime()
    expect(expires).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000)
    expect(expires).toBeLessThanOrEqual(before + 31 * 24 * 60 * 60 * 1000)
  })
})

describe('coupon.store — removeCoupon', () => {
  it('clears atom and localStorage', () => {
    couponStoreModule.applyCoupon('X')
    couponStoreModule.removeCoupon()
    expect(couponStoreModule.appliedCoupon.get()).toBe(null)
    expect(window.localStorage.getItem('appliedCoupon')).toBe(null)
  })
})

describe('coupon.store — getCouponCode', () => {
  it('returns the code when coupon is active', () => {
    couponStoreModule.applyCoupon('SUMMER10')
    expect(couponStoreModule.getCouponCode()).toBe('SUMMER10')
  })

  it('returns null when no coupon is applied', () => {
    expect(couponStoreModule.getCouponCode()).toBe(null)
  })

  it('removes the coupon and returns null when expired', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    couponStoreModule.applyCoupon('X')
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'))
    expect(couponStoreModule.getCouponCode()).toBe(null)
    expect(couponStoreModule.appliedCoupon.get()).toBe(null)
    expect(window.localStorage.getItem('appliedCoupon')).toBe(null)
  })
})

describe('coupon.store — initCouponStore', () => {
  it('restores valid coupon from localStorage', async () => {
    const future = new Date()
    future.setDate(future.getDate() + 5)
    window.localStorage.setItem('appliedCoupon', JSON.stringify({
      code: 'STORED',
      appliedAt: new Date().toISOString(),
      expiresAt: future.toISOString(),
      discount: null,
    }))
    await loadFresh()
    couponStoreModule.initCouponStore()
    expect(couponStoreModule.appliedCoupon.get()?.code).toBe('STORED')
  })

  it('ignores expired coupon from localStorage', async () => {
    const past = new Date('2020-01-01').toISOString()
    window.localStorage.setItem('appliedCoupon', JSON.stringify({
      code: 'OLD', expiresAt: past,
    }))
    await loadFresh()
    couponStoreModule.initCouponStore()
    expect(couponStoreModule.appliedCoupon.get()).toBe(null)
    expect(window.localStorage.getItem('appliedCoupon')).toBe(null)
  })

  it('removes malformed JSON from localStorage', async () => {
    window.localStorage.setItem('appliedCoupon', '{not json')
    await loadFresh()
    couponStoreModule.initCouponStore()
    expect(window.localStorage.getItem('appliedCoupon')).toBe(null)
  })
})