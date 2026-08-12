import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'

import { errorHandler } from './middleware/error.middleware.js'
import { prisma } from './config/prisma.js'

import authRoutes     from './routes/auth.routes.js'
import productRoutes  from './routes/product.routes.js'
import orderRoutes    from './routes/order.routes.js'
import paymentRoutes  from './routes/payment.routes.js'
import adminRoutes    from './routes/admin.routes.js'
import cartRoutes     from './routes/cart.routes.js'
import couponRoutes   from './routes/coupon.routes.js'

const app = express()

app.set('trust proxy', 1)

// ── Seguridad ────────────────────────────────────────────────
app.use(helmet())

// ── CORS ───────────────────────────────────────────────────────
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:4321',
      'http://127.0.0.1:4321',
    ]
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
}
app.use(cors(corsOptions))

// Rate limiting global — máximo 100 peticiones por 15 minutos por IP
// Deshabilitado en tests para no auto-bloquear la suite.
if (process.env.NODE_ENV !== 'test') {
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max:      100,
    message:  { error: 'Demasiadas peticiones, intenta más tarde' },
    validate: { xForwardedForHeader: false },
  }))
}

// ── Cookies ────────────────────────────────────────────────
app.use(cookieParser())

// ── Body parsing ─────────────────────────────────────────────
// Stripe, MercadoPago y Wompi webhooks necesitan el body en raw, por eso estas rutas van antes del json parser
// app.use('/api/v1/payments/webhook/stripe', express.raw({ type: 'application/json' })) // TODO: habilitar cuando se configure Stripe
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }))
app.use('/api/v1/payments/wompi/webhook', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Logs ─────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') app.use(morgan('dev'))

// ── Rutas ────────────────────────────────────────────────────
app.use('/api/v1/auth',     authRoutes)
app.use('/api/v1/products', productRoutes)
app.use('/api/v1/orders',   orderRoutes)
app.use('/api/v1/payments', paymentRoutes)
app.use('/api/v1/admin',    adminRoutes)
app.use('/api/v1/cart',     cartRoutes)
app.use('/api/v1/coupons',  couponRoutes)

// Health checks — verificar que el servidor y la DB están vivos con retry logic
app.get('/api/health', async (req, res) => {
  const maxRetries = 3
  const baseDelay = 1000 // 1 segundo

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`
      return res.json({ status: 'ok', db: 'connected', env: process.env.NODE_ENV })
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`[Health] DB connection failed after ${maxRetries} attempts:`, err.message)
        return res.status(503).json({
          status: 'error',
          db: 'disconnected',
          attempts: maxRetries,
          error: err.message
        })
      }
      const delay = baseDelay * Math.pow(2, attempt - 1) // 1s, 2s, 4s
      console.log(`[Health] DB connection attempt ${attempt} failed, retrying in ${delay}ms...`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
})

// ── Error handler global (siempre al final) ───────────────────
app.use(errorHandler)

export default app