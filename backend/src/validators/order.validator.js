import { body, param } from 'express-validator'

export const createOrder = [
  body('items')
    .notEmpty().withMessage('Los ítems son requeridos')
    .isArray({ min: 1 }).withMessage('Debe incluir al menos un producto'),
  body('items.*.productId')
    .notEmpty().withMessage('El ID del producto es requerido')
    .isString().withMessage('El ID del producto debe ser válido')
    .isLength({ min: 1 }).withMessage('El ID del producto debe ser válido'),
  body('items.*.quantity')
    .notEmpty().withMessage('La cantidad es requerida')
    .isInt({ min: 1 }).withMessage('La cantidad debe ser al menos 1'),
  body('items.*.size')
    .optional({ nullable: true })
    .trim()
    .escape()
    .isLength({ max: 20 }).withMessage('La talla no puede superar los 20 caracteres'),
  body('items.*.color')
    .optional({ nullable: true })
    .trim()
    .escape()
    .isLength({ max: 30 }).withMessage('El color no puede superar los 30 caracteres'),
  body('couponCode')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 50 }).withMessage('El código del cupón no puede superar los 50 caracteres'),
  body('address')
    .optional()
    .isObject().withMessage('La dirección debe ser un objeto'),
  body('address.label')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 50 }).withMessage('La etiqueta no puede superar los 50 caracteres'),
  body('address.street')
    .if(body('address').exists())
    .notEmpty().withMessage('La calle es requerida')
    .trim()
    .escape()
    .isLength({ max: 255 }).withMessage('La calle no puede superar los 255 caracteres'),
  body('address.departamento')
    .if(body('address').exists())
    .notEmpty().withMessage('El departamento es requerido')
    .trim()
    .escape()
    .isLength({ max: 100 }).withMessage('El departamento no puede superar los 100 caracteres'),
  body('address.municipio')
    .if(body('address').exists())
    .notEmpty().withMessage('El municipio es requerido')
    .trim()
    .escape()
    .isLength({ max: 100 }).withMessage('El municipio no puede superar los 100 caracteres'),
  body('address.city')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 100 }).withMessage('La ciudad no puede superar los 100 caracteres'),
  body('address.department')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 100 }).withMessage('El departamento no puede superar los 100 caracteres'),
  body('address.zipCode')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 20 }).withMessage('El código postal no puede superar los 20 caracteres'),
  body('address.fullName')
    .if(body('address').exists())
    .notEmpty().withMessage('El nombre del destinatario es requerido')
    .trim()
    .escape()
    .isLength({ max: 200 }).withMessage('El nombre completo no puede superar los 200 caracteres'),
  body('address.phone')
    .if(body('address').exists())
    .notEmpty().withMessage('El teléfono es requerido')
    .trim()
    .escape()
    .isLength({ max: 30 }).withMessage('El teléfono no puede superar los 30 caracteres'),
  body('notes')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 1000 }).withMessage('Las notas no pueden superar los 1000 caracteres'),
  body('shippingAddressId')
    .optional()
    .isString().withMessage('El ID de dirección debe ser válido')
    .isLength({ min: 1 }).withMessage('El ID de dirección debe ser válido')
]

export const getOrderById = [
  param('id')
    .notEmpty().withMessage('El ID de la orden es requerido')
    .isString().withMessage('El ID debe ser válido')
    .isLength({ min: 1 }).withMessage('El ID debe ser válido')
]