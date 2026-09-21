import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
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

describe('GET /api/health', () => {
  it('returns 200 when the DB answers', async () => {
    prisma.$queryRaw.mockResolvedValueOnce(1)
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', db: 'connected' })
  })

  it('returns 503 without leaking the internal error', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused at 10.0.0.3'))
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'error', db: 'disconnected' })
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.3')
  })

  it('unknown /api routes return JSON 404', async () => {
    const res = await request(app).get('/api/payments/webhook')
    expect(res.status).toBe(404)
    expect(res.body.error).toBeDefined()
  })
})
