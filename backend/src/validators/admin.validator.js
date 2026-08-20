import { body, param, query } from 'express-validator'

export const getAllOrders = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('La página debe ser un número entero positivo'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('El límite debe estar entre 1 y 100'),
  query('status')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 30 }).withMessage('El estado no puede superar los 30 caracteres')
]

export const updateOrderStatus = [
  param('id')
    .notEmpty().withMessage('El ID de la orden es requerido')
    .isInt({ min: 1 }).withMessage('El ID debe ser un número entero positivo'),
  body('status')
    .notEmpty().withMessage('El estado es requerido')
    .trim()
    .escape()
    .isIn(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']).withMessage('Estado de orden inválido')
]

export const createDiscount = [
  body('name')
    .trim()
    .notEmpty().withMessage('El nombre del descuento es requerido')
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres')
    .escape(),
  body('type')
    .notEmpty().withMessage('El tipo de descuento es requerido')
    .trim()
    .escape()
    .isIn(['PERCENTAGE', 'FIXED']).withMessage('Tipo de descuento inválido'),
  body('value')
    .notEmpty().withMessage('El valor del descuento es requerido')
    .isFloat({ min: 0 }).withMessage('El valor debe ser un número positivo'),
  body('startsAt')
    .optional()
    .isISO8601().withMessage('La fecha de inicio debe ser una fecha válida (ISO 8601)'),
  body('endsAt')
    .optional()
    .isISO8601().withMessage('La fecha de fin debe ser una fecha válida (ISO 8601)'),
  body('productIds')
    .optional()
    .isArray().withMessage('Los IDs de productos deben ser un array'),
  body('productIds.*')
    .optional()
    .isInt({ min: 1 }).withMessage('Cada ID de producto debe ser válido')
]

export const createCoupon = [
  body('code')
    .trim()
    .notEmpty().withMessage('El código del cupón es requerido')
    .escape()
    .isLength({ min: 2, max: 50 }).withMessage('El código debe tener entre 2 y 50 caracteres'),
  body('type')
    .notEmpty().withMessage('El tipo de cupón es requerido')
    .trim()
    .escape()
    .isIn(['PERCENTAGE', 'FIXED']).withMessage('Tipo de cupón inválido'),
  body('value')
    .notEmpty().withMessage('El valor del cupón es requerido')
    .isFloat({ min: 0 }).withMessage('El valor debe ser un número positivo'),
  body('minPurchase')
    .optional()
    .isFloat({ min: 0 }).withMessage('La compra mínima debe ser un número positivo'),
  body('maxUses')
    .optional()
    .isInt({ min: 1 }).withMessage('El número máximo de usos debe ser un entero positivo'),
  body('startsAt')
    .optional()
    .isISO8601().withMessage('La fecha de inicio debe ser una fecha válida (ISO 8601)'),
  body('endsAt')
    .optional()
    .isISO8601().withMessage('La fecha de fin debe ser una fecha válida (ISO 8601)')
]

export const updateCoupon = [
  param('id')
    .notEmpty().withMessage('El ID del cupón es requerido')
    .isLength({ min: 1, max: 100 }).withMessage('ID inválido'),
  body('code')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 2, max: 50 }).withMessage('El código debe tener entre 2 y 50 caracteres'),
  body('type')
    .optional()
    .trim()
    .escape()
    .isIn(['PERCENTAGE', 'FIXED']).withMessage('Tipo de cupón inválido'),
  body('value')
    .optional()
    .isFloat({ min: 0 }).withMessage('El valor debe ser un número positivo'),
  body('minPurchase')
    .optional({ nullable: true })
    .isFloat({ min: 0 }).withMessage('La compra mínima debe ser un número positivo'),
  body('maxUses')
    .optional({ nullable: true })
    .isInt({ min: 1 }).withMessage('El número máximo de usos debe ser un entero positivo'),
  body('startsAt')
    .optional({ nullable: true })
    .isISO8601().withMessage('La fecha de inicio debe ser una fecha válida (ISO 8601)'),
  body('endsAt')
    .optional({ nullable: true })
    .isISO8601().withMessage('La fecha de fin debe ser una fecha válida (ISO 8601)'),
  body('isActive')
    .optional()
    .isBoolean().withMessage('isActive debe ser un valor booleano')
]

export const getAllUsers = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('La página debe ser un número entero positivo'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('El límite debe estar entre 1 y 100'),
  query('search')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 200 }).withMessage('La búsqueda no puede superar los 200 caracteres'),
  query('role')
    .optional()
    .trim()
    .escape()
    .isIn(['CUSTOMER', 'ADMIN']).withMessage('Rol inválido')
]

export const getUserById = [
  param('id')
    .notEmpty().withMessage('El ID de usuario es requerido')
    .isLength({ min: 1, max: 100 }).withMessage('ID inválido')
]

export const updateUser = [
  param('id')
    .notEmpty().withMessage('El ID de usuario es requerido')
    .isLength({ min: 1, max: 100 }).withMessage('ID inválido'),
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('El nombre no puede estar vacío')
    .escape()
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('phone')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 30 }).withMessage('El teléfono no puede superar los 30 caracteres'),
  body('isActive')
    .optional()
    .isBoolean().withMessage('isActive debe ser un valor booleano')
]

export const deleteUser = [
  param('id')
    .notEmpty().withMessage('El ID de usuario es requerido')
    .isLength({ min: 1, max: 100 }).withMessage('ID inválido')
]

export const updateUserRole = [
  param('id')
    .notEmpty().withMessage('El ID de usuario es requerido')
    .isLength({ min: 1, max: 100 }).withMessage('ID inválido'),
  body('role')
    .notEmpty().withMessage('El rol es requerido')
    .trim()
    .escape()
    .isIn(['CUSTOMER', 'ADMIN']).withMessage('Rol inválido')
]

export const getAllProducts = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('La página debe ser un número entero positivo'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('El límite debe estar entre 1 y 100'),
  query('search')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 200 }).withMessage('La búsqueda no puede superar los 200 caracteres'),
  query('category')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 100 }).withMessage('La categoría no puede superar los 100 caracteres'),
  query('isActive')
    .optional()
    .isBoolean().withMessage('isActive debe ser un valor booleano')
]