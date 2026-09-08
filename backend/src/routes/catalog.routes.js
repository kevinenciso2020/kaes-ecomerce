import { Router } from 'express'
import * as CatalogController from '../controllers/catalog.controller.js'
import { validate } from '../middleware/validate.js'
import { catalogSizes } from '../validators/dashboard.validator.js'

const router = Router()

/**
 * Catálogo público — colors & sizes canónicos.
 * Sin auth, sin rate limit (más permisivo que /admin/*).
 * Se cachea en el cliente porque cambia muy rara vez (solo cuando el
 * admin agrega un color/talla nuevo).
 */
router.get('/colors', CatalogController.getColors)
router.get('/sizes',  validate(catalogSizes), CatalogController.getSizes)

export default router
