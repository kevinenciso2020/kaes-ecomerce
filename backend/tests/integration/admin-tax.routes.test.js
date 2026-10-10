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
  it('el PUT feliz llama al upsert con la tasa y el usuario', async () => {
    await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send({ rate: 5 })
    expect(prisma.taxSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ rate: 5, updatedById: 'u1' }),
    }))
  })
  it("acepta rate '5' como string (llega el número 5 al servicio)", async () => {
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send({ rate: '5' })
    expect(res.status).toBe(200)
    expect(prisma.taxSetting.upsert.mock.calls[0][0].update.rate).toBe(5)
  })
  it('409 si otra tasa propia de productos colisiona con la nueva', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ '?column?': 1 }]) // lock, colisión
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send({ rate: 5 })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).toContain('tasa propia')
    expect(prisma.taxSetting.upsert).not.toHaveBeenCalled()
  })
  it.each([[null], [undefined]])('rechaza rate=%s (null o ausente)', async (rate) => {
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send(rate === undefined ? {} : { rate })
    expect(res.status).toBe(400)
  })
  it.each([[19.123], ['19.999']])('rechaza rate=%s por más de 2 decimales', async (rate) => {
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send({ rate })
    expect(res.status).toBe(400)
    expect(res.body.errors[0].message).toBe('La tasa de IVA admite máximo 2 decimales')
  })
  it.each([[19], [5.5], ['19.25'], [0]])('acepta rate=%s', async (rate) => {
    const res = await request(app).put('/api/v1/admin/tax').set('Authorization', `Bearer ${token('SUPER_ADMIN')}`).send({ rate })
    expect(res.status).not.toBe(400)
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
    expect(prisma.$transaction).not.toHaveBeenCalled()
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
    expect(checkTaxRate).toHaveBeenCalledWith({ force: true })
  })
})
