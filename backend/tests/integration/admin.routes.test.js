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

describe('PUT /api/v1/admin/users/:id/role', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).put('/api/v1/admin/users/u1/role').send({ role: 'ADMIN' })
    expect(res.status).toBe(401)
  })

  it('returns 403 for CUSTOMER role', async () => {
    const token = tokenFor({ id: 'u1', email: 'c@d.com', role: 'CUSTOMER' })
    const res = await request(app)
      .put('/api/v1/admin/users/u1/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'ADMIN' })
    expect(res.status).toBe(403)
  })

  it('returns 403 for ADMIN role (privilege escalation guard)', async () => {
    const token = tokenFor({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' })
    const res = await request(app)
      .put('/api/v1/admin/users/u2/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'ADMIN' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/SUPER_ADMIN/)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('blocks an ADMIN from demoting/promoting users (CUSTOMER role assignment)', async () => {
    const token = tokenFor({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' })
    const res = await request(app)
      .put('/api/v1/admin/users/u2/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'CUSTOMER' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/SUPER_ADMIN/)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('updates the role for SUPER_ADMIN', async () => {
    prisma.user.update.mockResolvedValueOnce({
      id: 'u2', name: 'Target', email: 't@t.com', role: 'ADMIN',
    })
    const token = tokenFor({ id: 'sa1', email: 'sa@a.com', role: 'SUPER_ADMIN' })
    const res = await request(app)
      .put('/api/v1/admin/users/u2/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'ADMIN' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 'u2', role: 'ADMIN' })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { role: 'ADMIN' },
      select: { id: true, name: true, email: true, role: true },
    })
  })

  it('returns 404 when target user does not exist', async () => {
    prisma.user.update.mockRejectedValueOnce(Object.assign(new Error('Not found'), { code: 'P2025' }))
    const token = tokenFor({ id: 'sa1', email: 'sa@a.com', role: 'SUPER_ADMIN' })
    const res = await request(app)
      .put('/api/v1/admin/users/ghost/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'ADMIN' })
    expect(res.status).toBe(404)
  })

  it('returns 400 with an invalid role value', async () => {
    const token = tokenFor({ id: 'sa1', email: 'sa@a.com', role: 'SUPER_ADMIN' })
    const res = await request(app)
      .put('/api/v1/admin/users/u2/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'SUPER_ADMIN' })
    expect(res.status).toBe(400)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})
