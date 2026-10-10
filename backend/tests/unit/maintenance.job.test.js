import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    refreshToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    emailVerificationToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    passwordResetToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}))
vi.mock('../../src/config/sentry.js', () => ({ captureError: vi.fn(), captureMessage: vi.fn() }))
vi.mock('../../src/services/payment.service.js', () => ({ expireStaleOrders: vi.fn() }))
vi.mock('../../src/services/tax-check.service.js', () => ({ checkTaxRate: vi.fn() }))

const { runMaintenance } = await import('../../src/jobs/maintenance.js')
const { expireStaleOrders } = await import('../../src/services/payment.service.js')
const { checkTaxRate } = await import('../../src/services/tax-check.service.js')

describe('runMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    expireStaleOrders.mockResolvedValue(0)
    checkTaxRate.mockResolvedValue({ status: 'unchanged' })
  })

  it('revisa el IVA aunque expireStaleOrders lance', async () => {
    expireStaleOrders.mockRejectedValue(new Error('db caída'))
    await runMaintenance()
    expect(checkTaxRate).toHaveBeenCalledTimes(1)
  })

  it('no lanza aunque checkTaxRate lance', async () => {
    checkTaxRate.mockRejectedValue(new Error('inesperado'))
    await expect(runMaintenance()).resolves.toBeUndefined()
  })
})
