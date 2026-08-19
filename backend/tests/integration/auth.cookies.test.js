import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
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

const FRONTEND_LOCALHOST = 'http://localhost:4321'
const FRONTEND_PROD      = 'https://kaes.example.com'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  process.env.NODE_ENV = 'test'
})

const loginRequest = (body) =>
  request(app)
    .post('/api/v1/auth/login')
    .set('Origin', FRONTEND_LOCALHOST)
    .send(body)

describe('POST /api/v1/auth/login — cookie configuration (test env)', () => {
  it('sets both auth cookies with httpOnly, secure, lax (test env) and proper maxAge', async () => {
    const bcrypt = await import('bcryptjs')
    const hashedPassword = await bcrypt.hash('secret123', 4)
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', name: 'Ada', role: 'CUSTOMER', password: hashedPassword,
    })
    prisma.refreshToken.create.mockResolvedValueOnce({})

    const res = await loginRequest({ email: 'a@b.com', password: 'secret123' })

    expect(res.status).toBe(200)

    const setCookie = res.headers['set-cookie'] || []
    expect(setCookie).toHaveLength(2)

    const accessCookie  = setCookie.find((c) => c.startsWith('accessToken='))
    const refreshCookie = setCookie.find((c) => c.startsWith('refreshToken='))

    expect(accessCookie).toBeDefined()
    expect(refreshCookie).toBeDefined()

    for (const cookie of [accessCookie, refreshCookie]) {
      expect(cookie).toMatch(/HttpOnly/i)
      expect(cookie).toMatch(/Secure/i)
      expect(cookie).toMatch(/SameSite=Lax/i)
      expect(cookie).toMatch(/Path=\//i)
    }

    expect(accessCookie).toMatch(/Max-Age=900/)
    expect(refreshCookie).toMatch(/Max-Age=604800/)
  })
})

describe('POST /api/v1/auth/login — cookie configuration (production env)', () => {
  it('sets both auth cookies with SameSite=None and Secure in production env', async () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.FRONTEND_URL = FRONTEND_PROD

    let freshApp
    try {
      vi.resetModules()

      const bcrypt = await import('bcryptjs')
      const hashedPassword = await bcrypt.hash('secret123', 4)

      const freshPrisma = {
        user: {
          findMany: vi.fn(),
          findUnique: vi.fn().mockResolvedValueOnce({
            id: 'u1', email: 'a@b.com', name: 'Ada', role: 'CUSTOMER', password: hashedPassword,
          }),
          findFirst: vi.fn(),
          update: vi.fn(),
          create: vi.fn(),
        },
        refreshToken: {
          create: vi.fn().mockResolvedValueOnce({}),
          findUnique: vi.fn(),
          delete: vi.fn(),
          deleteMany: vi.fn(),
        },
      }
      vi.doMock('../../src/config/prisma.js', () => ({ prisma: freshPrisma }))
      vi.doMock('../../src/middleware/upload.middleware.js', async () => {
        const { makeUploadMock } = await import('../mocks/upload.mock.js')
        return makeUploadMock()
      })

      const mod = await import('../../src/app.js')
      freshApp = mod.default

      const res = await request(freshApp)
        .post('/api/v1/auth/login')
        .set('Origin', FRONTEND_PROD)
        .send({ email: 'a@b.com', password: 'secret123' })

      expect(res.status).toBe(200)
      const setCookie = res.headers['set-cookie'] || []
      expect(setCookie).toHaveLength(2)
      for (const cookie of setCookie) {
        expect(cookie).toMatch(/SameSite=None/i)
        expect(cookie).toMatch(/Secure/i)
        expect(cookie).toMatch(/HttpOnly/i)
      }
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })
})

describe('POST /api/v1/auth/logout — cookie clearing', () => {
  it('clears both auth cookies', async () => {
    prisma.refreshToken.deleteMany.mockResolvedValueOnce({ count: 0 })

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://localhost:4321')
      .send({})

    expect(res.status).toBe(200)
    const setCookie = res.headers['set-cookie'] || []
    const clearAccess  = setCookie.find((c) => c.startsWith('accessToken='))
    const clearRefresh = setCookie.find((c) => c.startsWith('refreshToken='))

    expect(clearAccess).toBeDefined()
    expect(clearRefresh).toBeDefined()
  })
})

describe('GET /api/v1/auth/me — cookie-based auth', () => {
  it('accepts the accessToken cookie without Authorization header', async () => {
    const jwt = await import('jsonwebtoken')
    const token = jwt.sign({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' }, process.env.JWT_SECRET, { expiresIn: '15m' })

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `accessToken=${token}`)

    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' })
  })

  it('rejects an invalid cookie', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', 'accessToken=garbage')

    expect(res.status).toBe(401)
  })
})
