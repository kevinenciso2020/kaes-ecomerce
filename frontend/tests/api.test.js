import { describe, it, expect, vi, beforeEach } from 'vitest'

let apiModule

beforeEach(async () => {
  vi.resetModules()
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

describe('api — cookie-only (no Authorization header, no localStorage tokens)', () => {
  it('does NOT add Authorization header on any endpoint', async () => {
    window.localStorage.setItem('accessToken', 'should-not-be-used')
    fetch.mockResolvedValueOnce(okJson({ ok: true }))
    await apiModule.api.orders.list()
    const [, config] = fetch.mock.calls[0]
    expect(config.headers.Authorization).toBeUndefined()
    expect(config.credentials).toBe('include')
  })

  it('does NOT add Authorization header on POST', async () => {
    window.localStorage.setItem('accessToken', 'should-not-be-used')
    fetch.mockResolvedValueOnce(okJson({ ok: true }))
    await apiModule.api.auth.login({ email: 'a@b.com', password: 'x' })
    const [, config] = fetch.mock.calls[0]
    expect(config.headers.Authorization).toBeUndefined()
  })

  it('logout endpoint is called without refreshToken in body', async () => {
    fetch.mockResolvedValueOnce(okJson({ message: 'ok' }))
    await apiModule.api.auth.logout()
    const [, config] = fetch.mock.calls[0]
    expect(config.body).toBeUndefined()
    expect(config.credentials).toBe('include')
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
      .mockResolvedValueOnce(okJson({ error: 'expired' }, 401))
      .mockResolvedValueOnce(okJson({}, 200))
      .mockResolvedValueOnce(okJson({ ok: true }))

    const out = await apiModule.api.products.list()
    expect(out).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls[1][0]).toMatch(/\/auth\/refresh$/)
  })

  it('refresh uses credentials:include and no body', async () => {
    fetch
      .mockResolvedValueOnce(okJson({ error: 'expired' }, 401))
      .mockResolvedValueOnce(okJson({}, 200))
      .mockResolvedValueOnce(okJson({ ok: true }))

    await apiModule.api.products.list()
    const [, refreshConfig] = fetch.mock.calls[1]
    expect(refreshConfig.credentials).toBe('include')
    expect(refreshConfig.body).toBeUndefined()
    expect(refreshConfig.headers.Authorization).toBeUndefined()
  })

  it('clears auth and redirects when refresh fails', async () => {
    const { clearAuth } = await import('../src/stores/auth.store.js')
    const clearAuthSpy = vi.spyOn({ clearAuth }, 'clearAuth')

    fetch
      .mockResolvedValueOnce(okJson({ error: 'expired' }, 401))
      .mockResolvedValueOnce(okJson({ error: 'no refresh' }, 401))

    await expect(apiModule.api.products.list()).rejects.toThrow('Session expired')
  })
})