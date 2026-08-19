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
          req.cookies?.refreshToken || req.body?.refreshToken || ''
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