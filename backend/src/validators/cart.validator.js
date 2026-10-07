import { body, param } from 'express-validator'

const id = (field, where = body) =>
  where(field)
    .isString().withMessage('ID inválido')
    .isLength({ min: 1, max: 100 }).withMessage('ID inválido')

export const addToCart = [
  id('productId'),
  body('quantity')
    .optional()
    .isInt({ min: 1, max: 10 }).withMessage('La cantidad debe estar entre 1 y 10'),
  body('size')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 20 }).withMessage('La talla no puede superar los 20 caracteres'),
  body('color')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 30 }).withMessage('El color no puede superar los 30 caracteres'),
]

export const updateCartItem = [
  id('itemId', param),
  body('quantity')
    .isInt({ min: 0, max: 10 }).withMessage('La cantidad debe estar entre 0 y 10'),
]

export const removeFromCart = [id('itemId', param)]
