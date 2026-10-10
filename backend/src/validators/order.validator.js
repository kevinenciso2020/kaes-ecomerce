import { body, param } from 'express-validator'
import { computeNitDv } from '../services/einvoice/nit.js'

// Tipos de documento del adquiriente (tabla 13.2.1 del Anexo DIAN 1.9).
export const BUYER_DOC_TYPES = ['13', '22', '31', '41', '47', '48']
const ALPHANUMERIC_DOC_TYPES = ['41', '47', '48']

export const createOrder = [
  body('items')
    .notEmpty().withMessage('Los ítems son requeridos')
    .isArray({ min: 1, max: 30 }).withMessage('Debe incluir entre 1 y 30 productos'),
  body('items.*.productId')
    .notEmpty().withMessage('El ID del producto es requerido')
    .isString().withMessage('El ID del producto debe ser válido')
    .isLength({ min: 1 }).withMessage('El ID del producto debe ser válido'),
  body('items.*.quantity')
    .notEmpty().withMessage('La cantidad es requerida')
    .isInt({ min: 1, max: 10 }).withMessage('La cantidad debe estar entre 1 y 10'),
  body('items.*.size')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 20 }).withMessage('La talla no puede superar los 20 caracteres'),
  body('items.*.color')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 30 }).withMessage('El color no puede superar los 30 caracteres'),
  body('couponCode')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('El código del cupón no puede superar los 50 caracteres'),
  body('address')
    .optional()
    .isObject().withMessage('La dirección debe ser un objeto'),
  body('address.label')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('La etiqueta no puede superar los 50 caracteres'),
  body('address.street')
    .if(body('address').exists())
    .notEmpty().withMessage('La calle es requerida')
    .trim()
    .isLength({ max: 255 }).withMessage('La calle no puede superar los 255 caracteres'),
  body('address.departamento')
    .if(body('address').exists())
    .notEmpty().withMessage('El departamento es requerido')
    .trim()
    .isLength({ max: 100 }).withMessage('El departamento no puede superar los 100 caracteres'),
  body('address.municipio')
    .if(body('address').exists())
    .notEmpty().withMessage('El municipio es requerido')
    .trim()
    .isLength({ max: 100 }).withMessage('El municipio no puede superar los 100 caracteres'),
  body('address.city')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('La ciudad no puede superar los 100 caracteres'),
  body('address.department')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('El departamento no puede superar los 100 caracteres'),
  body('address.zipCode')
    .optional()
    .trim()
    .isLength({ max: 20 }).withMessage('El código postal no puede superar los 20 caracteres'),
  body('address.fullName')
    .if(body('address').exists())
    .notEmpty().withMessage('El nombre del destinatario es requerido')
    .trim()
    .isLength({ max: 200 }).withMessage('El nombre completo no puede superar los 200 caracteres'),
  body('address.phone')
    .if(body('address').exists())
    .notEmpty().withMessage('El teléfono es requerido')
    .trim()
    .isLength({ max: 30 }).withMessage('El teléfono no puede superar los 30 caracteres'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage('Las notas no pueden superar los 1000 caracteres'),
  body('acceptTerms')
    .custom((v) => v === true || v === 'true')
    .withMessage('Debes aceptar los términos y la política de tratamiento de datos'),
  body('shippingAddressId')
    .optional()
    .isString().withMessage('El ID de dirección debe ser válido')
    .isLength({ min: 1 }).withMessage('El ID de dirección debe ser válido'),
  // Datos para la factura electrónica (opcional: sin ellos se factura a consumidor final).
  body('buyer')
    .optional({ nullable: true })
    .isObject().withMessage('Los datos de facturación deben ser un objeto'),
  body('buyer.docType')
    .if(body('buyer').exists({ values: 'null' }))
    .isIn(BUYER_DOC_TYPES).withMessage('Tipo de documento no válido'),
  body('buyer.docNumber')
    .if(body('buyer').exists({ values: 'null' }))
    .trim()
    .custom((value, { req }) => {
      const type = req.body.buyer?.docType
      const v = String(value ?? '')
      if (ALPHANUMERIC_DOC_TYPES.includes(type)) return /^[A-Za-z0-9]{3,20}$/.test(v)
      return /^[1-9]\d{4,14}$/.test(v)
    })
    .withMessage('Número de documento no válido (solo números, sin puntos, sin ceros a la izquierda)'),
  body('buyer.dv')
    .optional({ values: 'falsy' })
    .trim()
    .custom((value, { req }) => req.body.buyer?.docType === '31' && value === computeNitDv(req.body.buyer?.docNumber))
    .withMessage('El dígito de verificación no corresponde al NIT'),
  body('buyer.name')
    .if(body('buyer').exists({ values: 'null' }))
    .trim()
    .isLength({ min: 3, max: 450 }).withMessage('El nombre o razón social debe tener entre 3 y 450 caracteres'),
  body('buyer.personType')
    .optional({ values: 'falsy' })
    .isIn(['1', '2']).withMessage('Tipo de persona no válido'),
]

export const quoteOrder = [
  body('items')
    .isArray({ min: 1, max: 30 }).withMessage('Debe incluir entre 1 y 30 productos'),
  body('items.*.productId')
    .isString().withMessage('El ID del producto debe ser válido')
    .isLength({ min: 1, max: 100 }).withMessage('El ID del producto debe ser válido'),
  body('items.*.quantity')
    .isInt({ min: 1, max: 10 }).withMessage('La cantidad debe estar entre 1 y 10'),
  body('couponCode')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 50 }).withMessage('El código del cupón no puede superar los 50 caracteres'),
]

export const getOrderById = [
  param('id')
    .notEmpty().withMessage('El ID de la orden es requerido')
    .isString().withMessage('El ID debe ser válido')
    .isLength({ min: 1 }).withMessage('El ID debe ser válido')
]