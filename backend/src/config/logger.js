import pino from 'pino'

const NODE_ENV = process.env.NODE_ENV || 'development'
const IS_TEST = NODE_ENV === 'test'
const IS_DEV = NODE_ENV === 'development'

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-signature"]',
  'req.headers["x-request-id"]',
  'req.headers["x-mp-signature"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.accessToken',
  'req.body.code',
  'req.body.signature',
  'req.body.xSignature',
  'req.body.xRequestId',
  '*.password',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
  '*.secret',
  'env.JWT_SECRET',
  'env.JWT_REFRESH_SECRET',
  'env.MP_ACCESS_TOKEN',
  'env.MP_WEBHOOK_SECRET',
  'env.CLOUDINARY_API_SECRET',
  'env.SMTP_PASS',
  'env.WOMPI_PRIVATE_KEY',
  'env.STRIPE_SECRET_KEY',
  'env.STRIPE_WEBHOOK_SECRET',
]

const baseConfig = {
  level: process.env.LOG_LEVEL || (IS_DEV ? 'debug' : 'info'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  base: {
    service: 'kaes-backend',
    env: NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      hostname: bindings.hostname,
      service: bindings.service,
      env: bindings.env,
    }),
  },
}

const transport = IS_DEV && !IS_TEST
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,service,env',
        singleLine: false,
      },
    })
  : undefined

export const logger = transport
  ? pino(baseConfig, transport)
  : pino(baseConfig)

export const isTestEnv = IS_TEST

export default logger
