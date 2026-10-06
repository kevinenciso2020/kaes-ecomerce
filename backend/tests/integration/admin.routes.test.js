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
    refreshToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
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
  // isAdmin confirma en BD que el admin sigue activo y con el mismo rol.
  prisma.user.findFirst.mockResolvedValue({ id: 'admin' })
})

describe('isAdmin confirma el rol contra la BD', () => {
  it('consulta la cuenta con el id y el rol del token, exigiendo que siga activa', async () => {
    prisma.user.findMany.mockResolvedValueOnce([])
    const token = tokenFor({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' })
    await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${token}`)
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'a1', isActive: true, role: 'ADMIN' },
      select: { id: true },
    })
  })

  it('401 SESSION_OUTDATED si el admin fue desactivado o degradado (token aún vigente)', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null)
    const token = tokenFor({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' })
    const res = await request(app)
      .put('/api/v1/admin/users/u2')
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('SESSION_OUTDATED')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('un CUSTOMER recibe 403 sin consultar la BD', async () => {
    const token = tokenFor({ id: 'c1', email: 'c@d.com', role: 'CUSTOMER' })
    const res = await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })
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
    // Se revocan las sesiones para que el nuevo rol aplique en el próximo refresh
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u2' } })
  })

  it('un SUPER_ADMIN no puede cambiar su propio rol', async () => {
    const token = tokenFor({ id: 'sa1', email: 'sa@a.com', role: 'SUPER_ADMIN' })
    const res = await request(app)
      .put('/api/v1/admin/users/sa1/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'CUSTOMER' })
    expect(res.status).toBe(400)
    expect(prisma.user.update).not.toHaveBeenCalled()
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

describe('Jerarquía de administradores', () => {
  it('un ADMIN no puede desactivar a un SUPER_ADMIN', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'sa1', role: 'SUPER_ADMIN' })
    const token = tokenFor({ id: 'a1', email: 'a@a.com', role: 'ADMIN' })
    const res = await request(app)
      .put('/api/v1/admin/users/sa1')
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
    expect(res.status).toBe(403)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('nadie puede eliminarse a sí mismo', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'sa1', role: 'SUPER_ADMIN' })
    const token = tokenFor({ id: 'sa1', email: 'sa@a.com', role: 'SUPER_ADMIN' })
    const res = await request(app)
      .delete('/api/v1/admin/users/sa1')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  it('desactivar a un cliente revoca sus sesiones', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'c1', role: 'CUSTOMER' })
    prisma.user.update.mockResolvedValueOnce({ id: 'c1', isActive: false, role: 'CUSTOMER' })
    const token = tokenFor({ id: 'a1', email: 'a@a.com', role: 'ADMIN' })
    const res = await request(app)
      .put('/api/v1/admin/users/c1')
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
    expect(res.status).toBe(200)
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'c1' } })
  })
})
