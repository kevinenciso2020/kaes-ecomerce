import { body } from 'express-validator'

export const createContactMessage = [
  body('name')
    .trim()
    .notEmpty().withMessage('El nombre es requerido')
    .escape()
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('email')
    .trim()
    .notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('Debe ser un email válido')
    .normalizeEmail()
    .isLength({ max: 200 }).withMessage('El email no puede superar los 200 caracteres'),
  body('subject')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .escape()
    .isLength({ max: 200 }).withMessage('El asunto no puede superar los 200 caracteres'),
  body('message')
    .trim()
    .notEmpty().withMessage('El mensaje es requerido')
    .isLength({ min: 10, max: 2000 }).withMessage('El mensaje debe tener entre 10 y 2000 caracteres'),
]

export const getAllContactMessages = [
  body().custom((_value, { req }) => {
    if (req.query.page !== undefined) {
      const page = parseInt(req.query.page, 10)
      if (isNaN(page) || page < 1) throw new Error('La página debe ser un entero positivo')
    }
    if (req.query.limit !== undefined) {
      const limit = parseInt(req.query.limit, 10)
      if (isNaN(limit) || limit < 1 || limit > 100) throw new Error('El límite debe estar entre 1 y 100')
    }
    if (req.query.isRead !== undefined && !['true', 'false'].includes(req.query.isRead)) {
      throw new Error('isRead debe ser "true" o "false"')
    }
    return true
  }),
]

export const markContactMessageRead = [
  body('isRead')
    .optional()
    .isBoolean().withMessage('isRead debe ser booleano'),
]
