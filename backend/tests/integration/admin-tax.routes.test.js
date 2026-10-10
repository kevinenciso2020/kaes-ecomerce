import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    taxSetting: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}))

vi.mock('../../src/services/tax-check.service.js', () => ({ checkTaxRate: vi.fn().mockResolvedValue({ status: 'unchanged' }) }))

import request from 'supertest'
import app from '../../src/app.js'
import { prisma } from '../../src/config/prisma.js'
import { checkTaxRate } from '../../src/services/tax-check.service.js'

const token = (role) =>
  jwt.sign({ id: 'u1', email: 'u@a.com', role }, process.env.JWT_SECRET, { expiresIn: '15m' })

const row = { id: 1, rate: 19, pendingRate: 21, lastCheckAt: new Date('2026-10-09'), lastCheckRate: 21, lastCheckSource: 'https://x', updatedAt: new Date('2026-10-01') }

beforeEach(() => {
  vi.resetAllMocks()
  prisma.user.findFirst.mockResolvedValue({ id: 'u1' })
  prisma.taxSetting.findUnique.mockResolvedValue(row)
  prisma.$transaction.mockImplementation(async (cb) => cb(prisma))
  prisma.$executeRaw.mockResolvedValue(3)
  prisma.$queryRaw.mockResolvedValue([])
  checkTaxRate.mockResolvedValue({ status: 'unchanged' }) // resetAllMocks borra el valor del mock
})

describe('GET /admin/tax', () => {
  it('ADMIN sólo ve la tasa', async () => {
    const res = await request(app).get('/api/v1/admin/tax').set('Authorization', `Bearer ${token('ADMIN')}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ rate: 19 })
  })
  it('SUPER_ADMIN ve también la tasa pendiente y la última revisión', async () => {
    const res = await request(app).get('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`)
    expect(res.body).toMatchObject({ rate: 19, pendingRate: 21, lastCheckRate: 21 })
  })
  it('sin sesión → 401', async () => {
    expect((await request(app).get('/api/v1/admin/tax')).status).toBe(401)
  })
})

describe('PUT /admin/tax', () => {
  it('ADMIN → 403', async () => {
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('ADMIN')}`).send({ rate: 5 })
    expect(res.status).toBe(403)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it('SUPER_ADMIN cambia la tasa', async () => {
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send({ rate: 5 })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ rate: 5, changed: true })
    expect(prisma.taxSetting.upsert).toHaveBeenCalled()
  })
  it.each([[45], [-1], ['abc']])('rechaza rate=%s', async (rate) => {
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send({ rate })
    expect(res.status).toBe(400)
  })
})

describe('POST /admin/tax/apply-pending', () => {
  it('ADMIN → 403', async () => {
    const res = await request(app).post('/api/v1/admin/tax/apply-pending').set('Authorization', `Bearer ${token('ADMIN')}`)
    expect(res.status).toBe(403)
  })
  it('aplica la pendiente', async () => {
    const res = await request(app).post('/api/v1/admin/tax/apply-pending').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`)
    expect(res.status).toBe(200)
    expect(res.body.rate).toBe(21)
  })
  it('409 si no hay pendiente', async () => {
    prisma.taxSetting.findUnique.mockResolvedValue({ ...row, pendingRate: null })
    const res = await request(app).post('/api/v1/admin/tax/apply-pending').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`)
    expect(res.status).toBe(409)
  })
})

describe('POST /admin/tax/check', () => {
  it('ADMIN → 403', async () => {
    expect((await request(app).post('/api/v1/admin/tax/check').set('Authorization', `Bearer ${token('ADMIN')}`)).status).toBe(403)
  })
  it('SUPER_ADMIN fuerza la revisión', async () => {
    const res = await request(app).post('/api/v1/admin/tax/check').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('unchanged')
  })
})
