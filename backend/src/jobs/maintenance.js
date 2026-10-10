import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'
import { captureError } from '../config/sentry.js'
import { checkTaxRate } from '../services/tax-check.service.js'
import { expireStaleOrders } from '../services/payment.service.js'

const log = logger.child({ component: 'maintenance' })

const INTERVAL_MS = 10 * 60 * 1000 // cada 10 minutos

export const runMaintenance = async () => {
  try {
    const expired = await expireStaleOrders()
    const now = new Date()
    const [refresh, verification, reset] = await Promise.all([
      prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ])
    log.info({
      expiredOrders: expired,
      purgedRefreshTokens: refresh.count,
      purgedVerificationTokens: verification.count,
      purgedResetTokens: reset.count,
    }, 'maintenance.done')
    await checkTaxRate() // se auto-limita a 1 vez cada 23 h y no lanza
  } catch (err) {
    log.error({ err }, 'maintenance.failed')
    captureError(err, { job: 'maintenance' })
  }
}

export const startMaintenanceJobs = () => {
  // Primera corrida 1 min después de arrancar (no compite con el boot).
  const first = setTimeout(runMaintenance, 60 * 1000)
  const timer = setInterval(runMaintenance, INTERVAL_MS)
  first.unref()
  timer.unref()
  return () => { clearTimeout(first); clearInterval(timer) }
}
