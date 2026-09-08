import { query } from 'express-validator'

const VALID_RANGES = ['7d', '30d', '90d', '12m']
const VALID_SCALES = ['LETTER', 'NUMERIC', 'SHOE']

export const dashboardSales = [
  query('range')
    .optional().trim().escape()
    .isIn(VALID_RANGES).withMessage(`range debe ser uno de: ${VALID_RANGES.join(', ')}`),
]

export const dashboardTopProducts = [
  ...dashboardSales,
  query('limit')
    .optional().isInt({ min: 1, max: 50 }).withMessage('limit debe estar entre 1 y 50'),
]

export const dashboardRecentOrders = [
  query('limit')
    .optional().isInt({ min: 1, max: 50 }).withMessage('limit debe estar entre 1 y 50'),
]

export const dashboardLowStock = [
  query('limit')
    .optional().isInt({ min: 1, max: 100 }).withMessage('limit debe estar entre 1 y 100'),
]

export const catalogSizes = [
  query('scale')
    .optional().trim().escape()
    .isIn(VALID_SCALES).withMessage(`scale debe ser uno de: ${VALID_SCALES.join(', ')}`),
]
