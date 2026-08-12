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
  it('returns 200 when DB ping succeeds on first try', async () => {
    prisma.$queryRaw.mockResolvedValueOnce(1)
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', db: 'connected', env: 'test' })
  }, 10_000)

  it('returns 503 after 3 failed attempts', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'))
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(503)
    expect(res.body.db).toBe('disconnected')
    expect(res.body.attempts).toBe(3)
  }, 10_000)

  it('retries before succeeding', async () => {
    prisma.$queryRaw
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce(1)
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3)
  }, 10_000)
})