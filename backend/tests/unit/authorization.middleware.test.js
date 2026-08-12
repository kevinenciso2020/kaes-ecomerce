import { describe, it, expect, vi } from 'vitest'
import {
  authorize,
  authorizeRole,
  canManageAdmins,
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
} from '../../src/middleware/authorization.middleware.js'

const mockRes = () => {
  const res = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

describe('authorize', () => {
  it('returns 401 when req.user is missing', () => {
    const mw = authorize(PERMISSIONS.PRODUCT_CREATE)
    const req = {}
    const res = mockRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when role has none of the required permissions', () => {
    const mw = authorize(PERMISSIONS.USER_CREATE_ADMIN)
    const req = { user: { role: ROLES.CUSTOMER } }
    const res = mockRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Sin permisos suficientes' }))
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() when ADMIN has the required permission', () => {
    const mw = authorize(PERMISSIONS.PRODUCT_CREATE)
    const req = { user: { role: ROLES.ADMIN } }
    const res = mockRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('calls next() when SUPER_ADMIN has the required permission', () => {
    const mw = authorize(PERMISSIONS.USER_DELETE_ADMIN)
    const req = { user: { role: ROLES.SUPER_ADMIN } }
    const res = mockRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('passes if at least one permission matches (OR semantics)', () => {
    const mw = authorize(PERMISSIONS.USER_DELETE_ADMIN, PERMISSIONS.PRODUCT_CREATE)
    const req = { user: { role: ROLES.ADMIN } } // ADMIN has PRODUCT_CREATE only
    const res = mockRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('CUSTOMER has zero permissions', () => {
    expect(ROLE_PERMISSIONS.CUSTOMER).toEqual([])
  })
})

describe('authorizeRole', () => {
  it('returns 401 when req.user is missing', () => {
    const mw = authorizeRole(ROLES.ADMIN)
    const req = {}
    const res = mockRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 403 when role is below required level', () => {
    const mw = authorizeRole(ROLES.SUPER_ADMIN)
    const req = { user: { role: ROLES.ADMIN } }
    const res = mockRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('SUPER_ADMIN passes an ADMIN-only gate (hierarchical)', () => {
    const mw = authorizeRole(ROLES.ADMIN)
    const req = { user: { role: ROLES.SUPER_ADMIN } }
    const res = mockRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('ADMIN does NOT pass a SUPER_ADMIN-only gate', () => {
    const mw = authorizeRole(ROLES.SUPER_ADMIN)
    const req = { user: { role: ROLES.ADMIN } }
    const res = mockRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('canManageAdmins', () => {
  it('returns 403 when there is no user', () => {
    const req = {}
    const res = mockRes()
    const next = vi.fn()
    canManageAdmins(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('returns 403 for ADMIN role', () => {
    const req = { user: { role: ROLES.ADMIN } }
    const res = mockRes()
    const next = vi.fn()
    canManageAdmins(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('calls next() only for SUPER_ADMIN', () => {
    const req = { user: { role: ROLES.SUPER_ADMIN } }
    const res = mockRes()
    const next = vi.fn()
    canManageAdmins(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })
})