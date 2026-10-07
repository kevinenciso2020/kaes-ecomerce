import { Router } from 'express'
import { getProducts, getProductBySlug, getCategories } from '../controllers/product.controller.js'

const router = Router()

// Rutas públicas — cualquiera puede ver productos sin login.
// La gestión (crear/editar/eliminar productos y categorías) vive en /api/v1/admin.
router.get('/',              getProducts)
router.get('/categories',    getCategories)
router.get('/:slug',         getProductBySlug)

export default router
