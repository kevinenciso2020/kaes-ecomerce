import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'

const originalNodeEnv = process.env.NODE_ENV
process.env.NODE_ENV = 'production'

const { authLoginLimiter, authRegisterLimiter, authRefreshLimiter } = await import(
  '../../src/middleware/rateLimit.middleware.js'
)

const express = (await import('express')).default
const cookieParser = (await import('cookie-parser')).default
const testApp = express()
testApp.use(express.json())
testApp.use(cookieParser())
testApp.post(
  '/login',
  authLoginLimiter,
  (_req, res) => res.status(401).json({ error: 'bad creds' })
)
testApp.post(
  '/register',
  authRegisterLimiter,
  (_req, res) => res.status(201).json({ ok: true })
)
testApp.post(
  '/refresh',
  authRefreshLimiter,
  (_req, res) => res.status(200).json({ ok: true })
)

beforeEach(() => {
  process.env.NODE_ENV = 'production'
})

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv
})

describe('Rate limit on /auth/login (5 / 15min)', () => {
  it('allows up to 5 failed logins, then returns 429 on the 6th', async () => {
    for (let i = 1; i <= 5; i += 1) {
      const res = await request(testApp)
        .post('/login')
        .set('X-Forwarded-For', '10.0.0.1')
        .send({ email: 'flood@test.com', password: 'wrong' })
      expect(res.status).toBe(401)
    }

    const blocked = await request(testApp)
      .post('/login')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ email: 'flood@test.com', password: 'wrong' })
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      error: 'Demasiados intentos de inicio de sesión, intenta más tarde',
    })
  })

  it('counts failed logins only — successful logins do not consume the bucket', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await request(testApp)
        .post('/login')
        .set('X-Forwarded-For', '10.0.0.2')
        .send({ email: 'success@test.com', password: 'wrong' })
    }

    const ok = await request(testApp)
      .post('/login')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ email: 'success@test.com', password: 'wrong' })
    expect(ok.status).toBe(429)
  })

  it('keys the bucket by IP+email — different emails are independent', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await request(testApp)
        .post('/login')
        .set('X-Forwarded-For', '10.0.0.3')
        .send({ email: 'a@test.com', password: 'wrong' })
    }
    const aBlocked = await request(testApp)
      .post('/login')
      .set('X-Forwarded-For', '10.0.0.3')
      .send({ email: 'a@test.com', password: 'wrong' })
    expect(aBlocked.status).toBe(429)

    const bAllowed = await request(testApp)
      .post('/login')
      .set('X-Forwarded-For', '10.0.0.3')
      .send({ email: 'b@test.com', password: 'wrong' })
    expect(bAllowed.status).toBe(401)
  })
})

describe('Rate limit on /auth/register (5 / hour)', () => {
  it('allows up to 5 registrations, then returns 429 on the 6th', async () => {
    for (let i = 1; i <= 5; i += 1) {
      const res = await request(testApp)
        .post('/register')
        .set('X-Forwarded-For', '10.0.0.10')
        .send({
          name: 'Flood',
          email: 'flood@test.com',
          password: 'password123',
        })
      expect(res.status).toBe(201)
    }

    const blocked = await request(testApp)
      .post('/register')
      .set('X-Forwarded-For', '10.0.0.10')
      .send({
        name: 'Flood',
        email: 'flood@test.com',
        password: 'password123',
      })
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      error: 'Demasiados registros desde esta IP, intenta más tarde',
    })
  })

  it('keys the bucket by IP+email — same IP, different emails are independent', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await request(testApp)
        .post('/register')
        .set('X-Forwarded-For', '10.0.0.11')
        .send({
          name: 'A',
          email: `x${i}@test.com`,
          password: 'password123',
        })
    }

    const otherEmail = await request(testApp)
      .post('/register')
      .set('X-Forwarded-For', '10.0.0.11')
      .send({
        name: 'B',
        email: 'different@test.com',
        password: 'password123',
      })
    expect(otherEmail.status).toBe(201)
  })
})

describe('Rate limit on /auth/refresh (30 / 15min)', () => {
  it('allows up to 30 refreshes with the same token, then returns 429 on the 31st', async () => {
    for (let i = 1; i <= 30; i += 1) {
      const res = await request(testApp)
        .post('/refresh')
        .set('X-Forwarded-For', '10.0.0.20')
        .send({ refreshToken: 'token-a' })
      expect(res.status).toBe(200)
    }

    const blocked = await request(testApp)
      .post('/refresh')
      .set('X-Forwarded-For', '10.0.0.20')
      .send({ refreshToken: 'token-a' })
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      error: 'Demasiadas solicitudes de refresh, intenta más tarde',
    })
  })

  it('keys the bucket by IP+token — different tokens from the same IP are independent', async () => {
    for (let i = 1; i <= 30; i += 1) {
      await request(testApp)
        .post('/refresh')
        .set('X-Forwarded-For', '10.0.0.21')
        .send({ refreshToken: 'token-x' })
    }

    const differentToken = await request(testApp)
      .post('/refresh')
      .set('X-Forwarded-For', '10.0.0.21')
      .send({ refreshToken: 'token-y' })
    expect(differentToken.status).toBe(200)
  })

  it('reads the token from cookies as well as the body', async () => {
    for (let i = 1; i <= 30; i += 1) {
      const res = await request(testApp)
        .post('/refresh')
        .set('X-Forwarded-For', '10.0.0.22')
        .set('Cookie', 'refreshToken=token-cookie')
      expect(res.status).toBe(200)
    }

    const blocked = await request(testApp)
      .post('/refresh')
      .set('X-Forwarded-For', '10.0.0.22')
      .set('Cookie', 'refreshToken=token-cookie')
    expect(blocked.status).toBe(429)

    const differentToken = await request(testApp)
      .post('/refresh')
      .set('X-Forwarded-For', '10.0.0.22')
      .set('Cookie', 'refreshToken=token-cookie-other')
    expect(differentToken.status).toBe(200)
  })
})
