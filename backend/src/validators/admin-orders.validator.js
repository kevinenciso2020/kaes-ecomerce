import { body, param, query } from 'express-validator'

const VALID_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED']

export const adminListOrders = [
  query('page')
    .optional().isInt({ min: 1 }).withMessage('page debe ser entero positivo'),
  query('limit')
    .optional().isInt({ min: 1, max: 100 }).withMessage('limit debe estar entre 1 y 100'),
  query('status')
    .optional().trim()
    .isIn(VALID_STATUSES).withMessage(`status debe ser uno de: ${VALID_STATUSES.join(', ')}`),
  query('userId')
    .optional().isString().isLength({ min: 1, max: 100 }).withMessage('userId inválido'),
  query('dateFrom')
    .optional().isISO8601().withMessage('dateFrom debe ser ISO 8601'),
  query('dateTo')
    .optional().isISO8601().withMessage('dateTo debe ser ISO 8601'),
  query('needsReview')
    .optional().isIn(['true', 'false']).withMessage('needsReview debe ser true o false'),
  query('search')
    .optional().trim()
    .isLength({ max: 200 }).withMessage('search no puede superar 200 caracteres'),
]

export const adminOrderId = [
  param('id')
    .isString().notEmpty().withMessage('ID de orden requerido')
    .isLength({ min: 1, max: 100 }).withMessage('ID inválido'),
]

export const adminUpdateOrderStatus = [
  ...adminOrderId,
  body('status')
    .notEmpty().withMessage('status es requerido')
    .trim()
    .isIn(VALID_STATUSES).withMessage(`status debe ser uno de: ${VALID_STATUSES.join(', ')}`),
  body('note')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 1000 }).withMessage('La nota no puede superar los 1000 caracteres'),
]
