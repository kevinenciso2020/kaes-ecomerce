import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    emailVerificationToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    passwordResetToken: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}))

vi.mock('../../src/config/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../../src/services/email.service.js', () => ({
  sendVerificationEmail: mocks.sendVerificationEmail,
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}))

import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import * as AuthService from '../../src/services/auth.service.js'

beforeEach(() => {
  mocks.prisma.user.findUnique.mockReset()
  mocks.prisma.user.findFirst.mockReset()
  mocks.prisma.user.create.mockReset()
  mocks.prisma.user.update.mockReset()
  mocks.prisma.refreshToken.findUnique.mockReset()
  mocks.prisma.refreshToken.create.mockReset()
  mocks.prisma.refreshToken.delete.mockReset()
  mocks.prisma.refreshToken.deleteMany.mockReset()
  mocks.prisma.emailVerificationToken.findUnique.mockReset()
  mocks.prisma.emailVerificationToken.create.mockReset()
  mocks.prisma.emailVerificationToken.update.mockReset()
  mocks.prisma.emailVerificationToken.deleteMany.mockReset()
  mocks.prisma.passwordResetToken.findFirst.mockReset()
  mocks.prisma.passwordResetToken.update.mockReset()
  mocks.prisma.passwordResetToken.updateMany.mockReset()
  mocks.prisma.passwordResetToken.create.mockReset()
  mocks.prisma.passwordResetToken.deleteMany.mockReset()
  mocks.prisma.$transaction.mockReset()
  mocks.sendVerificationEmail.mockReset().mockResolvedValue(true)
  mocks.sendPasswordResetEmail.mockReset().mockResolvedValue(true)
})

// ─────────────────────────────────────────────────────────────
// registerUser
// ─────────────────────────────────────────────────────────────
describe('registerUser', () => {
  it('hashea password con bcrypt 12 rounds y crea el usuario con emailVerified=false', async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce(null)
    mocks.prisma.user.create.mockResolvedValueOnce({
      id: 'u1', name: 'Ada', email: 'a@b.com', role: 'CUSTOMER', emailVerified: false,
    })
    mocks.prisma.emailVerificationToken.create.mockResolvedValueOnce({ id: 't-1' })

    const result = await AuthService.registerUser({
      name: 'Ada', email: 'a@b.com', password: 'secret123',
    })

    expect(mocks.prisma.user.create).toHaveBeenCalledOnce()
    const createArg = mocks.prisma.user.create.mock.calls[0][0]
    expect(createArg.data.emailVerified).toBe(false)
    expect(createArg.data.password).not.toBe('secret123') // hasheada
    expect(createArg.data.password).toMatch(/^\$2[aby]\$12\$/) // bcrypt cost 12

    expect(result.user).toMatchObject({ id: 'u1', emailVerified: false })
    expect(result.user).not.toHaveProperty('password')
    expect(result).not.toHaveProperty('accessToken')
    expect(result).not.toHaveProperty('refreshToken')
  })

  it('crea verification token (32 bytes hex) y NO emite tokens de sesión', async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce(null)
    mocks.prisma.user.create.mockResolvedValueOnce({
      id: 'u1', name: 'Ada', email: 'a@b.com', role: 'CUSTOMER', emailVerified: false,
    })
    mocks.prisma.emailVerificationToken.create.mockResolvedValueOnce({ id: 't-1' })

    await AuthService.registerUser({ name: 'Ada', email: 'a@b.com', password: 'secret123' })

    expect(mocks.prisma.emailVerificationToken.create).toHaveBeenCalledOnce()
    const tokenData = mocks.prisma.emailVerificationToken.create.mock.calls[0][0].data
    expect(tokenData.tokenHash).toMatch(/^[a-f0-9]{64}$/) // sha256 de un token de 32 bytes = 64 hex
    expect(tokenData.expiresAt).toBeInstanceOf(Date)
    expect(tokenData.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('lanza 409 si el email ya está registrado', async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce({ id: 'u-existing', email: 'a@b.com' })

    await expect(
      AuthService.registerUser({ name: 'Ada', email: 'a@b.com', password: 'secret123' }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/ya está registrado/i) })

    expect(mocks.prisma.user.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────
// loginUser
// ─────────────────────────────────────────────────────────────
describe('loginUser', () => {
  it('lanza 401 si el email no existe', async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce(null)

    await expect(
      AuthService.loginUser({ email: 'ghost@x.com', password: 'whatever' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('lanza 401 si la contraseña es incorrecta', async () => {
    const hashed = await bcrypt.hash('right-pass', 4)
    mocks.prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', name: 'Ada', role: 'CUSTOMER',
      password: hashed, emailVerified: true,
    })

    await expect(
      AuthService.loginUser({ email: 'a@b.com', password: 'wrong-pass' }),
    ).rejects.toMatchObject({ status: 401 })

    expect(mocks.prisma.refreshToken.create).not.toHaveBeenCalled()
  })

  it('happy path: bcrypt compare OK, genera tokens y persiste RefreshToken', async () => {
    const hashed = await bcrypt.hash('secret123', 4)
    mocks.prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', name: 'Ada', role: 'CUSTOMER',
      password: hashed, emailVerified: true,
    })
    mocks.prisma.refreshToken.create.mockResolvedValueOnce({})

    const result = await AuthService.loginUser({ email: 'a@b.com', password: 'secret123' })

    expect(result.user).toMatchObject({ id: 'u1', email: 'a@b.com', emailVerified: true })
    expect(result.user).not.toHaveProperty('password')
    expect(result.accessToken).toBeTypeOf('string')
    expect(result.refreshToken).toBeTypeOf('string')

    // El access token es un JWT firmado con JWT_SECRET
    const decoded = jwt.verify(result.accessToken, process.env.JWT_SECRET)
    expect(decoded).toMatchObject({ id: 'u1', email: 'a@b.com' })

    // Refresh token persistido con expiración de 7 días
    expect(mocks.prisma.refreshToken.create).toHaveBeenCalledOnce()
    const rtArg = mocks.prisma.refreshToken.create.mock.calls[0][0].data
    expect(rtArg.userId).toBe('u1')
    expect(rtArg.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000)
  })
})

// ─────────────────────────────────────────────────────────────
// refreshAccessToken
// ─────────────────────────────────────────────────────────────
describe('refreshAccessToken', () => {
  it('rota tokens (delete old + create new) y emite nuevos tokens', async () => {
    const validToken = jwt.sign(
      { id: 'u1', email: 'a@b.com' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' },
    )

    mocks.prisma.refreshToken.findUnique.mockResolvedValueOnce({
      token: validToken, userId: 'u1', expiresAt: new Date(Date.now() + 60_000),
    })
    mocks.prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', name: 'Ada', role: 'CUSTOMER', emailVerified: true,
    })
    mocks.prisma.refreshToken.delete.mockResolvedValueOnce({})
    mocks.prisma.refreshToken.create.mockResolvedValueOnce({})

    const result = await AuthService.refreshAccessToken(validToken)

    expect(mocks.prisma.refreshToken.delete).toHaveBeenCalledWith({ where: { token: validToken } })
    expect(mocks.prisma.refreshToken.create).toHaveBeenCalledOnce()
    expect(result.accessToken).toBeTypeOf('string')
    expect(result.refreshToken).not.toBe(validToken) // rotado
  })

  it('lanza 401 si el JWT no es válido', async () => {
    await expect(
      AuthService.refreshAccessToken('not-a-jwt'),
    ).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/inv[áa]lido/i) })
  })

  it('lanza 401 si el token está expirado en DB (revocado)', async () => {
    const validToken = jwt.sign(
      { id: 'u1', email: 'a@b.com' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' },
    )

    mocks.prisma.refreshToken.findUnique.mockResolvedValueOnce(null)

    await expect(AuthService.refreshAccessToken(validToken)).rejects.toMatchObject({
      status: 401,
      message: expect.stringMatching(/expirado o revocado/i),
    })

    expect(mocks.prisma.refreshToken.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────
// verifyEmailToken — idempotencia
// ─────────────────────────────────────────────────────────────
describe('verifyEmailToken', () => {
  it('es idempotente cuando el usuario ya está verificado (no toca DB)', async () => {
    mocks.prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 't-1',
      tokenHash: 'whatever',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'u1',
      user: { id: 'u1', name: 'Ada', email: 'a@b.com', emailVerified: true },
    })

    const result = await AuthService.verifyEmailToken('some-token')

    expect(result.alreadyVerified).toBe(true)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('ejecuta transacción de 3 ops cuando el token es válido y el usuario no está verificado', async () => {
    mocks.prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 't-1',
      tokenHash: 'whatever',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'u1',
      user: { id: 'u1', name: 'Ada', email: 'a@b.com', emailVerified: false },
    })
    mocks.prisma.$transaction.mockResolvedValueOnce([])

    const result = await AuthService.verifyEmailToken('some-token')

    expect(result.alreadyVerified).toBe(false)
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce()
    const txOps = mocks.prisma.$transaction.mock.calls[0][0]
    expect(txOps).toHaveLength(3)
  })

  it('lanza 410 si el token expiró', async () => {
    mocks.prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 't-1',
      tokenHash: 'whatever',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      userId: 'u1',
      user: { id: 'u1', name: 'Ada', email: 'a@b.com', emailVerified: false },
    })

    await expect(AuthService.verifyEmailToken('expired')).rejects.toMatchObject({ status: 410 })
  })

  it('lanza 400 si el token ya fue usado', async () => {
    mocks.prisma.emailVerificationToken.findUnique.mockResolvedValueOnce({
      id: 't-1',
      tokenHash: 'whatever',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'u1',
      user: { id: 'u1', name: 'Ada', email: 'a@b.com', emailVerified: true },
    })

    await expect(AuthService.verifyEmailToken('used')).rejects.toMatchObject({ status: 400 })
  })
})

// ─────────────────────────────────────────────────────────────
// resetPasswordWithOtp — protección contra fuerza bruta
// ─────────────────────────────────────────────────────────────
describe('resetPasswordWithOtp', () => {
  it('lanza 400 y NO actualiza password si el código no matchea', async () => {
    mocks.prisma.passwordResetToken.findFirst.mockResolvedValueOnce(null)
    mocks.prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 1 })

    await expect(
      AuthService.resetPasswordWithOtp({
        email: 'a@b.com', code: '999999', newPassword: 'newpass1',
      }),
    ).rejects.toMatchObject({ status: 400 })

    expect(mocks.prisma.passwordResetToken.updateMany).toHaveBeenCalledOnce()
  })

  it('lanza 429 cuando los intentos del token superaron el cap (5)', async () => {
    mocks.prisma.passwordResetToken.findFirst.mockResolvedValueOnce({
      id: 't-1',
      tokenHash: 'whatever',
      attempts: 5,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'u1',
      user: { id: 'u1', email: 'a@b.com' },
    })
    mocks.prisma.passwordResetToken.update.mockResolvedValueOnce({})

    await expect(
      AuthService.resetPasswordWithOtp({
        email: 'a@b.com', code: '123456', newPassword: 'newpass1',
      }),
    ).rejects.toMatchObject({ status: 429 })

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('happy path: ejecuta transacción de 4 ops que cambia password y revoca TODAS las sesiones', async () => {
    mocks.prisma.passwordResetToken.findFirst.mockResolvedValueOnce({
      id: 't-1',
      tokenHash: 'whatever',
      attempts: 0,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'u1',
      user: { id: 'u1', email: 'a@b.com' },
    })
    // Las llamadas dentro del array (token.update, token.deleteMany, user.update, refreshToken.deleteMany)
    // deben devolver algo — usamos .mockResolvedValue para que la promesa del array se forme
    mocks.prisma.passwordResetToken.update.mockResolvedValue({})
    mocks.prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 })
    mocks.prisma.user.update.mockResolvedValue({})
    mocks.prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 })
    mocks.prisma.$transaction.mockResolvedValueOnce([])

    await AuthService.resetPasswordWithOtp({
      email: 'a@b.com', code: '123456', newPassword: 'newpass1',
    })

    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce()
    // 4 operaciones en la transacción: update token + delete otros + update user + delete refresh tokens
    expect(mocks.prisma.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't-1' },
        data: { usedAt: expect.any(Date) },
      }),
    )
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { password: expect.stringMatching(/^\$2[aby]\$12\$/) },
      }),
    )
    // La revocación de TODAS las sesiones debe estar presente
    expect(mocks.prisma.refreshToken.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    )
  })

  it('rechaza passwords muy cortas sin tocar la DB', async () => {
    await expect(
      AuthService.resetPasswordWithOtp({
        email: 'a@b.com', code: '123456', newPassword: '123',
      }),
    ).rejects.toMatchObject({ status: 400 })

    expect(mocks.prisma.passwordResetToken.findFirst).not.toHaveBeenCalled()
  })
})
