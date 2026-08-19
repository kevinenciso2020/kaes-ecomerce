import { Router } from 'express'
import { productUpload, uploadConstants } from '../middleware/upload.middleware.js'
import { getProducts, getProductBySlug, createProduct, updateProduct, deleteProduct, getCategories, createCategory } from '../controllers/product.controller.js'
import { isAuth, isAdmin } from '../middleware/auth.middleware.js'
import { validate } from '../middleware/validate.js'
import { createProduct as createProductValidator, updateProduct as updateProductValidator, deleteProduct as deleteProductValidator, createCategory as createCategoryValidator } from '../validators/product.validator.js'

const router = Router()

// Rutas públicas — cualquiera puede ver productos sin login
router.get('/',              getProducts)
router.get('/categories',    getCategories)
router.get('/:slug',         getProductBySlug)

// Rutas protegidas — solo admin
// IMPORTANTE: multer debe ejecutarse ANTES del validator para que req.body tenga los datos
router.post('/',             isAuth, isAdmin, productUpload.array('images', uploadConstants.MAX_FILES), createProductValidator, validate, createProduct)
router.put('/:id',           isAuth, isAdmin, productUpload.array('images', uploadConstants.MAX_FILES), updateProductValidator, validate, updateProduct)
router.delete('/:id',        deleteProductValidator, validate, isAuth, isAdmin, deleteProduct)
router.post('/categories',    createCategoryValidator, validate, isAuth, isAdmin, createCategory)

export default router