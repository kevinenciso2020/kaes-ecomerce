import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import { generateTokens } from '../../src/utils/jwt.utils.js'

describe('generateTokens', () => {
  const user = { id: 'user-123', email: 'test@example.com', role: 'CUSTOMER' }

  it('returns an accessToken and a refreshToken', () => {
    const { accessToken, refreshToken } = generateTokens(user)
    expect(typeof accessToken).toBe('string')
    expect(typeof refreshToken).toBe('string')
    expect(accessToken).not.toBe(refreshToken)
  })

  it('access token payload contains id, email, role', () => {
    const { accessToken } = generateTokens(user)
    const payload = jwt.verify(accessToken, process.env.JWT_SECRET)
    expect(payload.id).toBe('user-123')
    expect(payload.email).toBe('test@example.com')
    expect(payload.role).toBe('CUSTOMER')
  })

  it('refresh token only contains id', () => {
    const { refreshToken } = generateTokens(user)
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)
    expect(payload.id).toBe('user-123')
    expect(payload.email).toBeUndefined()
    expect(payload.role).toBeUndefined()
  })

  it('tokens are signed with their respective secrets', () => {
    const { accessToken, refreshToken } = generateTokens(user)
    expect(() => jwt.verify(accessToken, process.env.JWT_REFRESH_SECRET)).toThrow()
    expect(() => jwt.verify(refreshToken, process.env.JWT_SECRET)).toThrow()
  })

  it('tokens have expiration claims', () => {
    const { accessToken } = generateTokens(user)
    const payload = jwt.verify(accessToken, process.env.JWT_SECRET)
    expect(payload.exp).toBeDefined()
    expect(payload.iat).toBeDefined()
    expect(payload.exp).toBeGreaterThan(payload.iat)
  })
})