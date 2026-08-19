import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

describe('csrfProtection middleware', () => {
  let csrfProtection
  let originalNodeEnv

  beforeEach(async () => {
    vi.resetModules()
    originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.FRONTEND_URL = 'https://kaes.example.com'
    ;({ csrfProtection } = await import('../../src/middleware/csrf.middleware.js'))
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  const mockRes = () => {
    const res = {}
    res.status = vi.fn().mockReturnValue(res)
    res.json   = vi.fn().mockReturnValue(res)
    return res
  }

  it('skips safe methods (GET, HEAD, OPTIONS)', () => {
    const req  = { method: 'GET',    path: '/api/v1/orders', headers: {} }
    const res  = mockRes()
    const next = vi.fn()
    csrfProtection(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('skips when NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test'
    vi.resetModules()
    ;({ csrfProtection } = await import('../../src/middleware/csrf.middleware.js'))
    const req  = { method: 'POST', path: '/api/v1/orders', headers: {} }
    const res  = mockRes()
    const next = vi.fn()
    csrfProtection(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('skips webhook routes regardless of method', () => {
    const req  = { method: 'POST', path: '/api/v1/payments/webhook/stripe', headers: {} }
    const res  = mockRes()
    const next = vi.fn()
    csrfProtection(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('skips wompi webhook routes', () => {
    const req  = { method: 'POST', path: '/api/v1/payments/wompi/webhook', headers: {} }
    const res  = mockRes()
    const next = vi.fn()
    csrfProtection(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('rejects POST without Origin or Referer', () => {
    const req  = { method: 'POST', path: '/api/v1/orders', headers: {} }
    const res  = mockRes()
    const next = vi.fn()
    csrfProtection(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Origen requerido' })
  })

  it('rejects POST with disallowed Origin', () => {
    const req  = { method: 'POST', path: '/api/v1/orders', headers: { origin: 'https://evil.example.com' } }
    const res  = mockRes()
    const next = vi.fn()
    csrfProtection(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Origen no permitido por CSRF' })
  })

  it('rejects POST with disallowed Referer', () => {
    const req  = { method: 'POST', path: '/api/v1/orders', headers: { referer: 'https://evil.example.com/x' } }
    const res  = mockRes()
    const next = vi.fn()
    csrfProtection(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('allows POST with FRONTEND_URL origin', () => {
    const req  = { method: 'POST', path: '/api/v1/orders', headers: { origin: 'https://kaes.example.com' } }
    const res  = mockRes()
    const next = vi.fn()
    csrfProtection(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('allows POST with localhost origin', () => {
    const req  = { method: 'POST', path: '/api/v1/orders', headers: { origin: 'http://localhost:4321' } }
    const res  = mockRes()
    const next = vi.fn()
    csrfProtection(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('rejects PUT and DELETE without Origin', () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const req  = { method, path: '/api/v1/products/abc', headers: {} }
      const res  = mockRes()
      const next = vi.fn()
      csrfProtection(req, res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    }
  })
})
