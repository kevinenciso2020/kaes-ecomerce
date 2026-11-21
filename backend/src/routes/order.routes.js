import { Router } from 'express'
import { createOrder, getOrders, getOrderById, quoteOrder, getInvoicePdf, createGuestOrder, getGuestOrder, getGuestInvoicePdf } from '../controllers/order.controller.js'
import { isAuth, isAuthOrGuest } from '../middleware/auth.middleware.js'
import { requireVerifiedEmail } from '../middleware/requireVerifiedEmail.middleware.js'
import { validate } from '../middleware/validate.js'
import { orderCreateLimiter } from '../middleware/rateLimit.middleware.js'
import {
  createOrder as createOrderValidator,
  createGuestOrder as createGuestOrderValidator,
  getOrderById as getOrderByIdValidator,
  quoteOrder as quoteOrderValidator,
} from '../validators/order.validator.js'

const router = Router()

// Públicas (compra como invitado): el presupuesto es solo cálculo y el pedido
// de invitado no crea usuario ni dirección; su acceso posterior va por token.
router.post('/quote', validate(quoteOrderValidator), quoteOrder)
router.post('/guest', orderCreateLimiter, validate(createGuestOrderValidator), createGuestOrder)
router.get('/guest/:id', isAuthOrGuest, validate(getOrderByIdValidator), getGuestOrder)
router.get('/guest/:id/invoice.pdf', isAuthOrGuest, validate(getOrderByIdValidator), getGuestInvoicePdf)

router.use(isAuth)

router.post('/', orderCreateLimiter, requireVerifiedEmail, validate(createOrderValidator), createOrder)
router.get('/', getOrders)
router.get('/:id', validate(getOrderByIdValidator), getOrderById)
router.get('/:id/invoice.pdf', validate(getOrderByIdValidator), getInvoicePdf)

export default router
