import { Router } from 'express'
import { validateCoupon } from '../services/coupon.service.js'
import { couponLimiter } from '../middleware/rateLimit.middleware.js'

const router = Router()

// GET /api/v1/coupons/:code?subtotal=123
// Respuesta: { code, type, value, discount } — el total definitivo lo calcula
// POST /orders/quote; esto sólo sirve para dar feedback inmediato al cliente.
router.get('/:code', couponLimiter, async (req, res, next) => {
  try {
    const subtotal = Math.max(0, parseFloat(req.query.subtotal) || 0)
    const result = await validateCoupon(req.params.code, subtotal)
    if (!result.valid) {
      return res.status(400).json({ error: result.error, code: 'INVALID_COUPON' })
    }
    res.json(result.coupon)
  } catch (error) {
    next(error)
  }
})

export default router
