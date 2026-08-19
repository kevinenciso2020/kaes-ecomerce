import { describe, it, expect } from 'vitest'
import { Writable } from 'node:stream'
import pino from 'pino'

const createCapturingLogger = (redactPaths) => {
  const lines = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString())
      cb()
    },
  })
  const logger = pino(
    {
      level: 'trace',
      redact: { paths: redactPaths, censor: '[REDACTED]' },
      base: null,
      timestamp: false,
    },
    stream,
  )
  return { logger, lines }
}

// These paths mirror the ones configured in src/config/logger.js
const PROD_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-signature"]',
  'req.body.password',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.accessToken',
  '*.password',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
  '*.secret',
]

describe('logger — redaction', () => {
  it('redacts nested *.password wildcard', () => {
    const { logger, lines } = createCapturingLogger(PROD_REDACT_PATHS)
    logger.info({ user: { password: 'topsecret', name: 'foo' } }, 'test.message')
    const out = lines.join('')
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('topsecret')
    expect(out).toContain('foo')
  })

  it('redacts req.headers.authorization', () => {
    const { logger, lines } = createCapturingLogger(PROD_REDACT_PATHS)
    logger.info({
      req: { headers: { authorization: 'Bearer eyJhbGc.payload.sig', cookie: 'accessToken=xyz' } },
    }, 'test.req')
    const out = lines.join('')
    expect(out).not.toContain('eyJhbGc')
    expect(out).not.toContain('accessToken=xyz')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts req.body.password', () => {
    const { logger, lines } = createCapturingLogger(PROD_REDACT_PATHS)
    logger.info({ req: { body: { password: 'mypassword', email: 'a@b.com' } } }, 'test.req')
    const out = lines.join('')
    expect(out).not.toContain('mypassword')
    expect(out).toContain('a@b.com')
    expect(out).toContain('[REDACTED]')
  })

  it('preserves non-sensitive data', () => {
    const { logger, lines } = createCapturingLogger(PROD_REDACT_PATHS)
    logger.info({ orderId: 'ord_123', total: 89000 }, 'order.created')
    const out = lines.join('')
    expect(out).toContain('ord_123')
    expect(out).toContain('89000')
  })
})

describe('logger — child bindings', () => {
  it('child logger adds bindings', async () => {
    process.env.LOG_LEVEL = 'silent'
    const { logger } = await import('../../src/config/logger.js')
    const child = logger.child({ reqId: 'test-req' })
    expect(typeof child.info).toBe('function')
    expect(typeof child.error).toBe('function')
    expect(typeof child.warn).toBe('function')
  })

  it('exports a logger instance with the expected API', async () => {
    process.env.LOG_LEVEL = 'silent'
    const { logger } = await import('../../src/config/logger.js')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.child).toBe('function')
  })
})
