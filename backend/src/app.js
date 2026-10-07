import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'

import { logger } from './config/logger.js'
import { errorHandler } from './middleware/error.middleware.js'
import { csrfProtection, getAllowedOrigins, isWebhookPath } from './middleware/csrf.middleware.js'
import { isTrustedSsrRequest } from './middleware/ssr.middleware.js'
import { requestContextMiddleware } from './middleware/requestContext.middleware.js'
import { prisma } from './config/prisma.js'

import authRoutes     from './routes/auth.routes.js'
import productRoutes  from './routes/product.routes.js'
import orderRoutes    from './routes/order.routes.js'
import paymentRoutes  from './routes/payment.routes.js'
import adminRoutes    from './routes/admin.routes.js'
import cartRoutes     from './routes/cart.routes.js'
import couponRoutes   from './routes/coupon.routes.js'
import contactRoutes  from './routes/contact.routes.js'
import catalogRoutes  from './routes/catalog.routes.js'

const app = express()

// Saltos de proxy delante del API: 1 = sólo el proxy de Railway. Si el API
// queda detrás del proxy de Cloudflare (nube naranja) usa TRUST_PROXY=2; si no,
// req.ip sería la IP de Cloudflare y todos los clientes compartirían el rate limit.
app.set('trust proxy', Number.parseInt(process.env.TRUST_PROXY, 10) || 1)

// ── Request ID + base logger (debe ir antes que cualquier middleware que loguee) ──
app.use(requestContextMiddleware)

// ── HTTP access logs estructurados ─────────────────────────────
app.use(pinoHttp({
  logger,
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'info'
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  autoLogging: {
    ignore: (req) => req.url === '/api/health',
  },
  customProps: (req) => ({ reqId: req.id }),
}))

// ── Seguridad ────────────────────────────────────────────────
app.use(helmet())

// ── CORS ───────────────────────────────────────────────────────
// localhost sólo se permite fuera de producción. Un origen no permitido no
// lanza error (eso terminaba en 500): simplemente no recibe cabeceras CORS y
// el navegador bloquea la respuesta.
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    callback(null, getAllowedOrigins().includes(origin))
  },
  credentials: true,
}
app.use(cors(corsOptions))

// ── CSRF ────────────────────────────────────────────────────────
// Los cookies de auth viajan con `sameSite: 'none'` para funcionar
// cross-origin entre Vercel y Railway. Eso debilita la protección CSRF del
// navegador, así que añadimos un Origin-check obligatorio para cualquier
// request que modifique estado. Los webhooks de payments están excluidos
// porque vienen de los proveedores, no de un navegador.
app.use(csrfProtection)

// Rate limiting global — 300 peticiones / 15 min por IP.
// Excepciones:
//  • webhooks de pago (vienen de pocas IPs de los proveedores y deben entrar siempre)
//  • renderizado SSR de Vercel: todas las visitas salen de pocas IPs de Vercel;
//    el frontend se identifica con el header x-ssr-key = SSR_API_KEY.
// Deshabilitado en tests para no auto-bloquear la suite.
if (process.env.NODE_ENV !== 'test') {
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max:      300,
    standardHeaders: true,
    legacyHeaders: false,
    message:  { error: 'Demasiadas peticiones, intenta más tarde' },
    validate: { xForwardedForHeader: false },
    skip: (req) => isWebhookPath(req.path) || isTrustedSsrRequest(req),
  }))
}

// ── Cookies ────────────────────────────────────────────────
app.use(cookieParser())

// ── Body parsing ─────────────────────────────────────────────
// Los webhooks de MercadoPago y Wompi necesitan el body en raw (Buffer), por
// eso estas rutas van antes del json parser. `type: () => true` acepta
// cualquier content-type (MP a veces no manda application/json).
app.use('/api/v1/payments/webhook', express.raw({ type: () => true, limit: '1mb' }))
app.use('/api/v1/payments/wompi/webhook', express.raw({ type: () => true, limit: '1mb' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// ── Rutas ────────────────────────────────────────────────────
app.use('/api/v1/auth',     authRoutes)
app.use('/api/v1/products', productRoutes)
app.use('/api/v1/orders',   orderRoutes)
app.use('/api/v1/payments', paymentRoutes)
app.use('/api/v1/admin',    adminRoutes)
app.use('/api/v1/cart',     cartRoutes)
app.use('/api/v1/coupons',  couponRoutes)
app.use('/api/v1/contact',  contactRoutes)
app.use('/api/v1',          catalogRoutes)   // /colors, /sizes — público

// Health check para Railway y monitores de uptime. Responde rápido (una sola
// consulta con timeout de 3 s) y no expone detalles internos.
app.get('/api/health', async (req, res) => {
  const log = req.log || logger
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), 3000)),
    ])
    return res.json({ status: 'ok', db: 'connected' })
  } catch (err) {
    log.error({ err }, 'health.db_unreachable')
    return res.status(503).json({ status: 'error', db: 'disconnected' })
  }
})

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }))

// ── Error handler global (siempre al final) ───────────────────
app.use(errorHandler)

export default app
