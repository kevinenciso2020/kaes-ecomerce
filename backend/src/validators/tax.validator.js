import { body } from 'express-validator'

export const updateTaxRate = [
  body('rate')
    .exists({ checkNull: true }).withMessage('La tasa de IVA es requerida')
    .bail()
    .isFloat({ min: 0, max: 30 }).withMessage('La tasa de IVA debe estar entre 0 y 30')
    .toFloat(),
]
