import { Router } from 'express'
import { createOrder, getOrders, getOrderById, quoteOrder } from '../controllers/order.controller.js'
import { isAuth } from '../middleware/auth.middleware.js'
import { requireVerifiedEmail } from '../middleware/requireVerifiedEmail.middleware.js'
import { validate } from '../middleware/validate.js'
import { orderCreateLimiter } from '../middleware/rateLimit.middleware.js'
import {
  createOrder as createOrderValidator,
  getOrderById as getOrderByIdValidator,
  quoteOrder as quoteOrderValidator,
} from '../validators/order.validator.js'

const router = Router()

router.use(isAuth)

router.post('/quote', validate(quoteOrderValidator), quoteOrder)
router.post('/', orderCreateLimiter, requireVerifiedEmail, validate(createOrderValidator), createOrder)
router.get('/', getOrders)
router.get('/:id', validate(getOrderByIdValidator), getOrderById)

export default router
