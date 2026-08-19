import { describe, it, expect, vi } from 'vitest'
import multer from 'multer'
import { errorHandler } from '../../src/middleware/error.middleware.js'

const mockLog = () => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
})

const mockRes = () => {
  const res = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

const call = (err, overrides = {}) => {
  const req = { method: 'GET', path: '/api/v1/test', id: 'test-req-id', log: mockLog(), ...overrides }
  const res = mockRes()
  const next = vi.fn()
  errorHandler(err, req, res, next)
  return { res, next, req }
}

describe('errorHandler — Multer errors', () => {
  const cases = [
    { code: 'LIMIT_FILE_SIZE',       status: 413, msg: /5 MB/ },
    { code: 'LIMIT_FILE_COUNT',      status: 400, msg: /10 por petici/ },
    { code: 'LIMIT_UNEXPECTED_FILE', status: 400, msg: /inesperado/ },
    { code: 'LIMIT_FIELD_COUNT',     status: 400, msg: /Demasiados campos/ },
    { code: 'LIMIT_FIELD_SIZE',      status: 400, msg: /tama/ },
    { code: 'LIMIT_FIELD_NAME',      status: 400, msg: /largo/ },
    { code: 'LIMIT_PART_COUNT',      status: 400, msg: /multipart/ },
  ]

  for (const c of cases) {
    it(`maps ${c.code} → ${c.status}`, () => {
      const err = new multer.MulterError(c.code)
      const { res } = call(err)
      expect(res.status).toHaveBeenCalledWith(c.status)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(c.msg) }),
      )
    })
  }

  it('falls back to 400 for unknown multer codes', () => {
    const err = new multer.MulterError('UNKNOWN_CODE')
    const { res } = call(err)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('errorHandler — custom codes', () => {
  it('INVALID_FILE_CONTENT uses err.status or 400', () => {
    const { res } = call({ code: 'INVALID_FILE_CONTENT', message: 'bad content', status: 422 })
    expect(res.status).toHaveBeenCalledWith(422)
    expect(res.json).toHaveBeenCalledWith({ error: 'bad content' })
  })

  it('UNSUPPORTED_FILE_TYPE defaults to 400', () => {
    const { res } = call({ code: 'UNSUPPORTED_FILE_TYPE', message: 'no svg' })
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('errorHandler — Prisma codes', () => {
  it('P2002 → 409', () => {
    const { res } = call({ code: 'P2002', message: 'unique' })
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('único') })
  })

  it('P2025 → 404', () => {
    const { res } = call({ code: 'P2025', message: 'not found' })
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

describe('errorHandler — generic', () => {
  it('uses err.status when present', () => {
    const { res } = call({ status: 418, message: 'teapot' })
    expect(res.status).toHaveBeenCalledWith(418)
  })

  it('uses err.statusCode when err.status absent', () => {
    const { res } = call({ statusCode: 422, message: 'unprocessable' })
    expect(res.status).toHaveBeenCalledWith(422)
  })

  it('defaults to 500 with default message', () => {
    const { res } = call(new Error('boom'))
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'boom' })
  })

  it('falls back to generic message when err.message missing', () => {
    const { res } = call({})
    expect(res.json).toHaveBeenCalledWith({ error: 'Error interno del servidor' })
  })
})