import rateLimit from 'express-rate-limit'

const isTest = process.env.NODE_ENV === 'test'

const noop = (_req, _res, next) => next()

const standardOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  validate: { xForwardedForHeader: false },
}

const normalizeEmail = (email) =>
  typeof email === 'string' ? email.toLowerCase().trim() : ''

export const authLoginLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: { error: 'Demasiados intentos de inicio de sesión, intenta más tarde' },
      keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}`,
    })

export const authRegisterLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      skipSuccessfulRequests: false,
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: { error: 'Demasiados registros desde esta IP, intenta más tarde' },
      keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}`,
    })

export const authRefreshLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      skipSuccessfulRequests: false,
      windowMs: 15 * 60 * 1000,
      max: 30,
      message: { error: 'Demasiadas solicitudes de refresh, intenta más tarde' },
      keyGenerator: (req) => {
        const token =
          req.cookies?.refreshToken || ''
        return `${req.ip}:${token}`
      },
    })

export const emailVerifyLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      skipSuccessfulRequests: true,
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: { error: 'Demasiadas solicitudes de verificación, intenta más tarde' },
      keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}`,
    })

export const passwordResetRequestLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      skipSuccessfulRequests: true,
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: { error: 'Demasiadas solicitudes de recuperación, intenta más tarde' },
      keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}`,
    })

export const passwordResetConfirmLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      skipSuccessfulRequests: false,
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: { error: 'Demasiados intentos de código, intenta más tarde' },
      keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}`,
    })

export const contactLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      skipSuccessfulRequests: true,
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: { error: 'Has enviado demasiados mensajes, intenta más tarde' },
      keyGenerator: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}`,
    })

// Clave por usuario autenticado (si lo hay) o por IP.
const userOrIpKey = (req) => (req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`)

// Crear órdenes: 20 intentos / 15 min por usuario.
export const orderCreateLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      skipSuccessfulRequests: false,
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: { error: 'Demasiados pedidos en poco tiempo, intenta más tarde' },
      keyGenerator: userOrIpKey,
    })

// Iniciar/verificar pagos: 40 / 15 min por usuario (la página de resultado
// verifica varias veces mientras espera la confirmación).
export const paymentInitLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      skipSuccessfulRequests: false,
      windowMs: 15 * 60 * 1000,
      max: 40,
      message: { error: 'Demasiadas solicitudes de pago, intenta más tarde' },
      keyGenerator: userOrIpKey,
    })

// Validar cupones: 20 / 15 min por IP (evita enumerar códigos).
export const couponLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      skipSuccessfulRequests: false,
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: { error: 'Demasiados intentos de cupón, intenta más tarde' },
    })

// Admin: 600 / 15 min por usuario (el dashboard dispara varias peticiones).
export const adminLimiter = isTest
  ? noop
  : rateLimit({
      ...standardOptions,
      skipSuccessfulRequests: false,
      windowMs: 15 * 60 * 1000,
      max: 600,
      message: { error: 'Demasiadas peticiones de admin, intenta más tarde' },
      keyGenerator: userOrIpKey,
    })
