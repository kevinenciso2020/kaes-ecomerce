import { logger } from './logger.js'

// Variables sin las cuales el backend no debe arrancar en producción.
const REQUIRED = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'FRONTEND_URL',
  'BACKEND_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
]

// Recomendadas: el backend arranca, pero se avisa en los logs.
const RECOMMENDED = [
  'SENTRY_DSN',
  'SSR_API_KEY',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM_EMAIL',
  'WOMPI_PUBLIC_KEY',
  'WOMPI_INTEGRITY_SECRET',
  'WOMPI_EVENTS_SECRET',
]

export const validateEnv = () => {
  const missing = REQUIRED.filter((k) => !process.env[k])
  const weakSecrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET'].filter(
    (k) => process.env[k] && process.env[k].length < 32,
  )
  const recommendedMissing = RECOMMENDED.filter((k) => !process.env[k])
    .filter((k) => !(k === 'WOMPI_EVENTS_SECRET' && process.env.WOMPI_WEBHOOK_SECRET))

  if (recommendedMissing.length) {
    logger.warn({ missing: recommendedMissing }, 'env.recommended_missing')
  }

  if (process.env.NODE_ENV === 'production') {
    if (missing.length || weakSecrets.length) {
      logger.fatal({ missing, weakSecrets }, 'env.invalid — el servidor no arranca')
      throw new Error(`Variables de entorno inválidas: faltan [${missing.join(', ')}], secretos débiles [${weakSecrets.join(', ')}]`)
    }
    if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
      throw new Error('JWT_SECRET y JWT_REFRESH_SECRET deben ser distintos')
    }
  }
}
