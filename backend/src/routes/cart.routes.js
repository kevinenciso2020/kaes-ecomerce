import { Router } from 'express'
import { getCart, addToCart, updateCartItem, removeFromCart, clearCart } from '../controllers/cart.controller.js'
import { isAuth } from '../middleware/auth.middleware.js'
import { validate } from '../middleware/validate.js'
import {
  addToCart as addToCartValidator,
  updateCartItem as updateCartItemValidator,
  removeFromCart as removeFromCartValidator,
} from '../validators/cart.validator.js'

const router = Router()

// Todas las rutas del carrito requieren estar autenticado
router.use(isAuth)

router.get('/',                   getCart)
router.post('/',                  validate(addToCartValidator), addToCart)
router.put('/:itemId',            validate(updateCartItemValidator), updateCartItem)
router.delete('/:itemId',         validate(removeFromCartValidator), removeFromCart)
router.delete('/',                clearCart)

export default router
