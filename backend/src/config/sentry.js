import * as Sentry from '@sentry/node'

let initialized = false

const NODE_ENV = process.env.NODE_ENV || 'development'

export const initSentry = () => {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) {
    return false
  }

  Sentry.init({
    dsn,
    environment: NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: NODE_ENV === 'production' ? 0.1 : 0,
    sendDefaultPii: false,
  })

  initialized = true
  return true
}

export const isSentryEnabled = () => initialized

export const captureError = (err, context) => {
  if (!initialized) return
  Sentry.captureException(err, context ? { extra: context } : undefined)
}

export default Sentry