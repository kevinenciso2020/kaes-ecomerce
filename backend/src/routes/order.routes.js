import { Router } from 'express'
import { createOrder, getOrders, getOrderById } from '../controllers/order.controller.js'
import { isAuth } from '../middleware/auth.middleware.js'
import { requireVerifiedEmail } from '../middleware/requireVerifiedEmail.middleware.js'
import { validate } from '../middleware/validate.js'
import { createOrder as createOrderValidator, getOrderById as getOrderByIdValidator } from '../validators/order.validator.js'

const router = Router()

router.use(isAuth)

router.post('/', requireVerifiedEmail, validate(createOrderValidator), createOrder)
router.get('/', getOrders)
router.get('/:id', validate(getOrderByIdValidator), getOrderById)

export default router