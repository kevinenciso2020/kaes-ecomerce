import { body, param, query } from 'express-validator'

// imageUrls: JSON array o texto con URLs separadas por comas/saltos de línea.
// La validación fina la hace el servicio.
const imageUrlsRule = () =>
  body('imageUrls')
    .optional({ nullable: true })
    .custom((v) => {
      const raw = typeof v === 'string' ? v : JSON.stringify(v)
      if (raw.length > 20000) throw new Error('Demasiadas URLs de imágenes')
      return true
    })

export const adminListProducts = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('La página debe ser un entero positivo'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('El límite debe estar entre 1 y 100'),
  query('search')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('La búsqueda no puede superar los 200 caracteres'),
  query('category')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('La categoría no puede superar los 100 caracteres'),
  query('isActive')
    .optional()
    .custom((v) => v === 'true' || v === 'false' || typeof v === 'boolean')
    .withMessage('isActive debe ser true o false'),
  query('lowStock')
    .optional()
    .custom((v) => v === 'true' || v === 'false' || typeof v === 'boolean')
    .withMessage('lowStock debe ser true o false'),
]

export const adminProductId = [
  param('id')
    .isString().notEmpty().withMessage('ID requerido')
    .isLength({ min: 1, max: 100 }).withMessage('ID inválido'),
]

export const adminImageId = [
  param('imageId')
    .isString().notEmpty().withMessage('imageId requerido')
    .isLength({ min: 1, max: 100 }).withMessage('imageId inválido'),
]

export const adminCreateProduct = [
  body('name')
    .trim().notEmpty().withMessage('El nombre es requerido')
    .isLength({ min: 2, max: 200 }).withMessage('El nombre debe tener entre 2 y 200 caracteres'),
  body('description')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 5000 }).withMessage('La descripción no puede superar los 5000 caracteres'),
  body('price')
    .notEmpty().withMessage('El precio es requerido')
    .isFloat({ min: 100, max: 50000000 }).withMessage('El precio debe estar entre $100 y $50.000.000 COP'),
  imageUrlsRule(),
  body('stock')
    .optional({ nullable: true })
    .isInt({ min: 0 }).withMessage('El stock debe ser entero positivo'),
  body('lowStockThreshold')
    .optional({ nullable: true })
    .isInt({ min: 0 }).withMessage('lowStockThreshold debe ser entero positivo'),
  body('categoryId').optional().isString().withMessage('categoryId debe ser texto'),
  body('categorySlug').optional().isString().withMessage('categorySlug debe ser texto'),
  body('categoryId').custom((value, { req }) => {
    if (!value && !req.body.categorySlug) {
      throw new Error('La categoría es requerida (categoryId o categorySlug)')
    }
    return true
  }),
  body('isFeatured')
    .optional()
    .custom((v) => v === 'true' || v === 'false' || typeof v === 'boolean')
    .withMessage('isFeatured debe ser boolean'),
  body('isActive')
    .optional()
    .custom((v) => v === 'true' || v === 'false' || typeof v === 'boolean')
    .withMessage('isActive debe ser boolean'),
  body('variants')
    .optional({ nullable: true })
    .custom((v) => {
      if (typeof v === 'string') {
        try { JSON.parse(v) } catch { throw new Error('variants debe ser JSON válido') }
      } else if (!Array.isArray(v)) {
        throw new Error('variants debe ser array')
      }
      return true
    }),
  body('sizeIds')
    .optional({ nullable: true })
    .custom((v) => {
      if (typeof v === 'string') {
        try { JSON.parse(v) } catch { throw new Error('sizeIds debe ser JSON válido') }
      } else if (!Array.isArray(v)) {
        throw new Error('sizeIds debe ser array')
      }
      return true
    }),
]

export const adminUpdateProduct = [
  ...adminProductId,
  body('name')
    .optional().trim()
    .isLength({ min: 2, max: 200 }).withMessage('El nombre debe tener entre 2 y 200 caracteres'),
  body('description')
    .optional({ nullable: true }).trim()
    .isLength({ max: 5000 }).withMessage('La descripción no puede superar los 5000 caracteres'),
  body('price').optional().isFloat({ min: 100, max: 50000000 }).withMessage('El precio debe estar entre $100 y $50.000.000 COP'),
  imageUrlsRule(),
  body('stock').optional().isInt({ min: 0 }).withMessage('El stock debe ser entero positivo'),
  body('lowStockThreshold').optional().isInt({ min: 0 }).withMessage('lowStockThreshold debe ser entero positivo'),
  body('categoryId').optional().isString(),
  body('categorySlug').optional().isString(),
  body('isFeatured').optional()
    .custom((v) => v === 'true' || v === 'false' || typeof v === 'boolean')
    .withMessage('isFeatured debe ser boolean'),
  body('isActive').optional()
    .custom((v) => v === 'true' || v === 'false' || typeof v === 'boolean')
    .withMessage('isActive debe ser boolean'),
  body('variants')
    .optional({ nullable: true })
    .custom((v) => {
      if (typeof v === 'string') {
        try { JSON.parse(v) } catch { throw new Error('variants debe ser JSON válido') }
      } else if (!Array.isArray(v)) {
        throw new Error('variants debe ser array')
      }
      return true
    }),
  body('sizeIds')
    .optional({ nullable: true })
    .custom((v) => {
      if (typeof v === 'string') {
        try { JSON.parse(v) } catch { throw new Error('sizeIds debe ser JSON válido') }
      } else if (!Array.isArray(v)) {
        throw new Error('sizeIds debe ser array')
      }
      return true
    }),
]

export const adminUpsertVariants = [
  ...adminProductId,
  body('variants')
    .notEmpty().withMessage('variants es requerido')
    .custom((v) => {
      const parsed = typeof v === 'string' ? JSON.parse(v) : v
      if (!Array.isArray(parsed)) throw new Error('variants debe ser array')
      for (const variant of parsed) {
        if (variant.stock !== undefined && (isNaN(parseInt(variant.stock)) || parseInt(variant.stock) < 0)) {
          throw new Error('Cada variant.stock debe ser entero positivo')
        }
      }
      return true
    }),
]

export const adminAddImages = [
  ...adminProductId,
  imageUrlsRule(),
]

export const adminDeleteProduct = [
  ...adminProductId,
  query('hard').optional().isIn(['true', 'false']).withMessage('hard debe ser true o false'),
]

const hexRule = () =>
  body('hex')
    .trim()
    .matches(/^#[0-9A-Fa-f]{6}$/).withMessage('El color debe ser un hex como #1A2B3C')

const idParam = () =>
  param('id').isString().isLength({ min: 1, max: 100 }).withMessage('ID inválido')

export const adminCreateColor = [
  body('name').trim().isLength({ min: 2, max: 40 }).withMessage('El nombre del color debe tener entre 2 y 40 caracteres'),
  hexRule(),
]

export const adminUpdateColor = [
  idParam(),
  body('name').optional().trim().isLength({ min: 2, max: 40 }).withMessage('El nombre del color debe tener entre 2 y 40 caracteres'),
  body('hex').optional().trim().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('El color debe ser un hex como #1A2B3C'),
]

export const adminIdParam = [idParam()]

export const adminCreateCategory = [
  body('name').trim().isLength({ min: 2, max: 60 }).withMessage('El nombre de la categoría debe tener entre 2 y 60 caracteres'),
  body('description').optional({ nullable: true }).trim().isLength({ max: 300 }).withMessage('Máximo 300 caracteres'),
]

export const adminUpdateCategory = [
  idParam(),
  body('name').optional().trim().isLength({ min: 2, max: 60 }).withMessage('El nombre de la categoría debe tener entre 2 y 60 caracteres'),
  body('description').optional({ nullable: true }).trim().isLength({ max: 300 }).withMessage('Máximo 300 caracteres'),
]
