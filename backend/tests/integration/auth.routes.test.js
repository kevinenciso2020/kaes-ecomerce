import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

import request from 'supertest'
import { prisma } from '../../src/config/prisma.js'
import app from '../../src/app.js'

const tokenFor = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/auth/me', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-token')
    expect(res.status).toBe(401)
  })

  it('returns 200 with the decoded user payload', async () => {
    const token = tokenFor({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' })
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' })
  })
})

describe('GET /api/v1/auth/admins', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/auth/admins')
    expect(res.status).toBe(401)
  })

  it('returns 403 for CUSTOMER role', async () => {
    const token = tokenFor({ id: 'u1', email: 'c@d.com', role: 'CUSTOMER' })
    const res = await request(app)
      .get('/api/v1/auth/admins')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('returns 200 and the admin list for ADMIN role', async () => {
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'a1', email: 'admin@a.com', name: 'Admin', role: 'ADMIN' },
    ])
    const token = tokenFor({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' })
    const res = await request(app)
      .get('/api/v1/auth/admins')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).not.toHaveProperty('password')
  })
})

describe('POST /api/v1/auth/make-admin', () => {
  it('returns 403 for non-SUPER_ADMIN even if ADMIN', async () => {
    const token = tokenFor({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' })
    const res = await request(app)
      .post('/api/v1/auth/make-admin')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'someone@example.com' })
    expect(res.status).toBe(403)
  })

  it('updates the user role for SUPER_ADMIN', async () => {
    prisma.user.update.mockResolvedValueOnce({
      id: 'u2', email: 'someone@example.com', name: 'Someone', role: 'ADMIN',
    })
    const token = tokenFor({ id: 'sa1', email: 'sa@a.com', role: 'SUPER_ADMIN' })
    const res = await request(app)
      .post('/api/v1/auth/make-admin')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'someone@example.com' })
    expect(res.status).toBe(200)
    expect(res.body.user.role).toBe('ADMIN')
  })

  it('returns 404 when target user does not exist', async () => {
    prisma.user.update.mockRejectedValueOnce(new Error('Record not found'))
    const token = tokenFor({ id: 'sa1', email: 'sa@a.com', role: 'SUPER_ADMIN' })
    const res = await request(app)
      .post('/api/v1/auth/make-admin')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'ghost@example.com' })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/auth/register', () => {
  it('returns 400 with missing fields', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'a@b.com' })
    expect(res.status).toBe(400)
  })

  it('returns 400 with short password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'a@b.com', password: '123' })
    expect(res.status).toBe(400)
  })
})