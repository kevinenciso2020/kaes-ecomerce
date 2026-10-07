import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('../../src/services/email.service.js', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue(true),
  sendOrderCancelled: vi.fn().mockResolvedValue(true),
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
  sendContactNotification: vi.fn().mockResolvedValue(true),
}))

const { prisma } = await import('../../src/config/prisma.js')
const { loginUser, refreshAccessToken } = await import('../../src/services/auth.service.js')
const bcrypt = (await import('bcryptjs')).default

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "refresh_tokens", "users" CASCADE')
})

afterAll(async () => {
  await prisma.$disconnect()
})

const PASSWORD = 'Clave12345'

const loginNewUser = async () => {
  await prisma.user.create({
    data: { email: 'ada@test.co', password: await bcrypt.hash(PASSWORD, 4), name: 'Ada', emailVerified: true },
  })
  return loginUser({ email: 'ada@test.co', password: PASSWORD })
}

describe('Rotación de refresh tokens (BD real)', () => {
  it('dos pestañas refrescan A LA VEZ con el mismo token: ambas obtienen sesión y nada se revoca', async () => {
    const session = await loginNewUser()

    const [a, b] = await Promise.all([
      refreshAccessToken(session.refreshToken),
      refreshAccessToken(session.refreshToken),
    ])

    expect(a.refreshToken).not.toBe(session.refreshToken)
    expect(b.refreshToken).not.toBe(a.refreshToken)
    // El original quedó marcado como reemplazado y hay dos sesiones nuevas vivas.
    const rows = await prisma.refreshToken.findMany()
    expect(rows).toHaveLength(3)
    expect(rows.filter((r) => r.replacedAt)).toHaveLength(1)

    // Las dos sesiones nuevas siguen funcionando.
    await expect(refreshAccessToken(a.refreshToken)).resolves.toBeTruthy()
    await expect(refreshAccessToken(b.refreshToken)).resolves.toBeTruthy()
  })

  it('reuso del token viejo pasada la gracia (posible robo) → revoca TODAS las sesiones', async () => {
    const session = await loginNewUser()
    const next = await refreshAccessToken(session.refreshToken)

    // Simula que pasaron 2 minutos desde la rotación.
    await prisma.refreshToken.updateMany({
      where: { replacedAt: { not: null } },
      data: { replacedAt: new Date(Date.now() - 2 * 60 * 1000) },
    })

    await expect(refreshAccessToken(session.refreshToken)).rejects.toMatchObject({ status: 401 })
    expect(await prisma.refreshToken.count()).toBe(0)
    await expect(refreshAccessToken(next.refreshToken)).rejects.toMatchObject({ status: 401 })
  })
})
