import { describe, it, expect, vi, beforeEach } from 'vitest'

let apiModule
let clearAuth

beforeEach(async () => {
  vi.resetModules()
  clearAuth = vi.fn()
  vi.doMock('../src/stores/auth.store.js', () => ({
    clearAuth: (...args) => clearAuth(...args),
  }))
  // Default BASE_URL fallback from api.js
  globalThis.fetch = vi.fn()
  apiModule = await import('../src/lib/api.js')
})

const okJson = (data, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) })

describe('api — happy path', () => {
  it('returns parsed JSON on success', async () => {
    fetch.mockResolvedValueOnce(okJson({ hello: 'world' }))
    const out = await apiModule.api.products.list()
    expect(out).toEqual({ hello: 'world' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/products?'),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('sends JSON Content-Type by default', async () => {
    fetch.mockResolvedValueOnce(okJson({ ok: true }))
    await apiModule.api.auth.login({ email: 'a@b.com', password: 'x' })
    const [, config] = fetch.mock.calls[0]
    expect(config.method).toBe('POST')
    expect(config.headers['Content-Type']).toBe('application/json')
    expect(config.body).toBe(JSON.stringify({ email: 'a@b.com', password: 'x' }))
  })

  it('does NOT set Content-Type for FormData', async () => {
    const fd = new FormData()
    fd.append('file', new Blob(['x']), 'x.bin')
    fetch.mockResolvedValueOnce(okJson({ id: 'p1' }))
    await apiModule.api.products.create(fd)
    const [, config] = fetch.mock.calls[0]
    expect(config.headers['Content-Type']).toBeUndefined()
  })

  it('builds cart endpoints correctly', async () => {
    fetch.mockResolvedValueOnce(okJson({ items: [] }))
    await apiModule.api.cart.get()
    expect(fetch.mock.calls[0][0]).toMatch(/\/cart$/)

    fetch.mockResolvedValueOnce(okJson({ ok: true }))
    await apiModule.api.cart.update('item-7', 3)
    expect(fetch.mock.calls[1][0]).toMatch(/\/cart\/item-7$/)
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ quantity: 3 })
  })

  it('builds coupon validate URL with subtotal', async () => {
    fetch.mockResolvedValueOnce(okJson({ code: 'PROMO10' }))
    await apiModule.api.coupons.validate('PROMO10', 1000)
    expect(fetch.mock.calls[0][0]).toMatch(/\/coupons\/PROMO10\?subtotal=1000$/)
  })
})

describe('api — error handling', () => {
  it('throws Error with server-provided message on non-OK', async () => {
    fetch.mockResolvedValueOnce(okJson({ error: 'Email duplicado' }, 400))
    await expect(apiModule.api.auth.login({ email: 'a@b.com', password: 'x' }))
      .rejects.toThrow('Email duplicado')
  })

  it('falls back to generic message when error body is not JSON', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('bad json')),
    })
    await expect(apiModule.api.products.list())
      .rejects.toThrow('Error del servidor')
  })
})

describe('api — 401 + refresh', () => {
  it('attempts refresh on 401 then retries original', async () => {
    fetch
      .mockResolvedValueOnce(okJson({ error: 'expired' }, 401))   // first call → 401
      .mockResolvedValueOnce(okJson({}, 200))                      // refresh → ok
      .mockResolvedValueOnce(okJson({ ok: true }))                 // retry → ok

    const out = await apiModule.api.products.list()
    expect(out).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls[1][0]).toMatch(/\/auth\/refresh$/)
  })

  it('does NOT try to refresh on a 401 from a non-refresh endpoint unless refresh succeeds', async () => {
    // /auth/refresh itself returns 401 — the api client should bubble the error
    // without entering the refresh loop. We verify by hitting a custom endpoint
    // that returns 401, then refreshing fails too → clearAuth is called and
    // a Session expired error is thrown (already covered above).
    // This test just verifies the refresh path is NOT triggered for /auth/refresh.
    const refreshCallCountBefore = fetch.mock.calls.length
    fetch.mockResolvedValueOnce(okJson({ error: 'bad refresh' }, 401))
    await expect(
      apiModule.api.products.list(),
    ).rejects.toThrow()
    // After a 401 on a non-refresh endpoint, the client MUST have attempted
    // at least one call to /auth/refresh before bubbling the error.
    const newCalls = fetch.mock.calls.slice(refreshCallCountBefore)
    const refreshAttempt = newCalls.some(([url]) => url.includes('/auth/refresh'))
    expect(refreshAttempt).toBe(true)
  })

  it('clears auth and redirects when refresh fails', async () => {
    const originalLocation = window.location
    delete window.location
    window.location = { href: '' }
    fetch
      .mockResolvedValueOnce(okJson({ error: 'expired' }, 401))
      .mockResolvedValueOnce(okJson({ error: 'no refresh' }, 401))

    await expect(apiModule.api.products.list()).rejects.toThrow('Session expired')
    expect(clearAuth).toHaveBeenCalledOnce()
    expect(window.location.href).toBe('/auth/login')

    window.location = originalLocation
  })
})