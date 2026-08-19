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
    refreshToken: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    emailVerificationToken: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    passwordResetToken: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

vi.mock('../../src/config/email.js', () => ({
  emailTransporter: {
    sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
  },
  verifyEmailConfig: vi.fn().mockResolvedValue(true),
}))

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

  it('returns 201, creates user with emailVerified=false, and does NOT issue tokens', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null) // email no existe
    prisma.user.create.mockResolvedValueOnce({
      id: 'u-new', name: 'Ada', email: 'a@b.com', role: 'CUSTOMER', emailVerified: false,
    })
    prisma.emailVerificationToken.create.mockResolvedValueOnce({ id: 'tok-1' })

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'a@b.com', password: 'secret123' })

    expect(res.status).toBe(201)
    expect(res.body.user.emailVerified).toBe(false)
    expect(res.body.user).not.toHaveProperty('password')
    expect(res.body).not.toHaveProperty('accessToken')
    expect(res.body).not.toHaveProperty('refreshToken')
    expect(res.body.message).toMatch(/verificar/i)
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledOnce()
  })

  it('returns 409 if email already exists', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com' })
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada', email: 'a@b.com', password: 'secret123' })
    expect(res.status).toBe(409)
  })
})

describe('GET /api/v1/auth/verify-email', () => {
  it('returns 400 without token', async () => {
    const res = await request(app).get('/api/v1/auth/verify-email')
    expect(res.status).toBe(400)
  })

  it('returns 400 for unknown token', async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .get('/api/v1/auth/verify-email?token=invalid')
    expect(res.status).toBe(400)
  })

  it('returns 400 for already-used token', async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 'tok-1',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      user: { id: 'u1', name: 'Ada', email: 'a@b.com', emailVerified: true },
    })
    const res = await request(app)
      .get('/api/v1/auth/verify-email?token=already-used')
    expect(res.status).toBe(400)
  })

  it('returns 410 for expired token', async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 'tok-1',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      user: { id: 'u1', name: 'Ada', email: 'a@b.com', emailVerified: false },
    })
    const res = await request(app)
      .get('/api/v1/auth/verify-email?token=expired-token')
    expect(res.status).toBe(410)
  })

  it('returns 200 and marks user verified on valid token', async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 'tok-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      userId: 'u1',
      user: { id: 'u1', name: 'Ada', email: 'a@b.com', emailVerified: false },
    })
    prisma.$transaction.mockResolvedValueOnce([])

    const res = await request(app)
      .get('/api/v1/auth/verify-email?token=valid-token')
    expect(res.status).toBe(200)
    expect(res.body.user.emailVerified).toBe(true)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it('is idempotent if user already verified', async () => {
    prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 'tok-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      userId: 'u1',
      user: { id: 'u1', name: 'Ada', email: 'a@b.com', emailVerified: true },
    })
    const res = await request(app)
      .get('/api/v1/auth/verify-email?token=valid-token')
    expect(res.status).toBe(200)
    expect(res.body.alreadyVerified).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/auth/resend-verification', () => {
  it('always returns 200 (no info leak about email existence)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'ghost@example.com' })
    expect(res.status).toBe(200)
  })

  it('generates new token and revokes previous for unverified user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', name: 'Ada', email: 'a@b.com', emailVerified: false,
    })
    prisma.$transaction.mockResolvedValueOnce([])

    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'a@b.com' })
    expect(res.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it('does nothing for already-verified user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', name: 'Ada', email: 'a@b.com', emailVerified: true,
    })
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'a@b.com' })
    expect(res.status).toBe(200)
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled()
  })

  it('returns 400 with missing email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 with invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'not-an-email' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/auth/verification-status', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/auth/verification-status')
    expect(res.status).toBe(401)
  })

  it('returns verification status for authed user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', emailVerified: false, emailVerifiedAt: null,
    })
    const token = tokenFor({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' })
    const res = await request(app)
      .get('/api/v1/auth/verification-status')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.status.emailVerified).toBe(false)
  })
})

describe('POST /api/v1/auth/forgot-password', () => {
  it('returns 400 with missing email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 with invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' })
    expect(res.status).toBe(400)
  })

  it('always returns 200 even if the user does not exist (no info leak)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@example.com' })
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/c[oó]digo/i)
    expect(res.body.expiresInMinutes).toBe(10)
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled()
  })

  it('generates a token and revokes previous for an existing user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', name: 'Ada', email: 'a@b.com',
    })
    prisma.$transaction.mockResolvedValueOnce([])

    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'a@b.com' })
    expect(res.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })
})

describe('POST /api/v1/auth/reset-password', () => {
  it('returns 400 with missing email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ code: '123456', password: 'newpass1', confirmPassword: 'newpass1' })
    expect(res.status).toBe(400)
  })

  it('returns 400 with missing code', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: 'a@b.com', password: 'newpass1', confirmPassword: 'newpass1' })
    expect(res.status).toBe(400)
  })

  it('returns 400 with non-6-digit code', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: 'a@b.com', code: '12345', password: 'newpass1', confirmPassword: 'newpass1' })
    expect(res.status).toBe(400)
  })

  it('returns 400 with short password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: 'a@b.com', code: '123456', password: '123', confirmPassword: '123' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when passwords do not match', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: 'a@b.com', code: '123456', password: 'newpass1', confirmPassword: 'different' })
    expect(res.status).toBe(400)
  })

  it('returns 400 with invalid/unknown/expired code and bumps attempts counter', async () => {
    prisma.passwordResetToken.findFirst.mockResolvedValueOnce(null)
    prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 1 })

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: 'a@b.com', code: '999999', password: 'newpass1', confirmPassword: 'newpass1' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/inv[áa]lido|expirado/i)
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledOnce()
  })

  it('returns 429 when attempts on the active token exceed the cap', async () => {
    prisma.passwordResetToken.findFirst.mockResolvedValueOnce({
      id: 'tok-1',
      attempts: 5,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'u1',
      user: { id: 'u1', email: 'a@b.com' },
    })
    prisma.passwordResetToken.update.mockResolvedValueOnce({})

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: 'a@b.com', code: '123456', password: 'newpass1', confirmPassword: 'newpass1' })
    expect(res.status).toBe(429)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 200 on valid code, updates password and revokes refresh tokens', async () => {
    prisma.passwordResetToken.findFirst.mockResolvedValueOnce({
      id: 'tok-1',
      attempts: 0,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'u1',
      user: { id: 'u1', email: 'a@b.com' },
    })
    prisma.$transaction.mockResolvedValueOnce([])

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: 'a@b.com', code: '123456', password: 'newpass1', confirmPassword: 'newpass1' })

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/actualizada/i)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    // La transacción debe contener 4 operaciones: update token, delete others, update user password, delete refresh tokens
    const txArg = prisma.$transaction.mock.calls[0][0]
    expect(Array.isArray(txArg)).toBe(true)
    expect(txArg).toHaveLength(4)
  })
})