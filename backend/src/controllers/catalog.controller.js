import * as ColorsService from '../services/colors.service.js'
import * as SizesService  from '../services/sizes.service.js'
import * as CategoriesService from '../services/categories.service.js'

const handle = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json(await fn(req))
  } catch (err) { next(err) }
}

export const getColors = async (req, res, next) => {
  try {
    const colors = await ColorsService.listColors()
    res.json(colors)
  } catch (err) { next(err) }
}

export const getSizes = async (req, res, next) => {
  try {
    const sizes = await SizesService.listSizes({ scale: req.query.scale })
    res.json(sizes)
  } catch (err) { next(err) }
}

export const createColor    = handle((req) => ColorsService.createColor(req.body), 201)
export const updateColor    = handle((req) => ColorsService.updateColor(req.params.id, req.body))
export const deleteColor    = handle((req) => ColorsService.deleteColor(req.params.id))

export const listCategories = handle(() => CategoriesService.listCategories())
export const createCategory = handle((req) => CategoriesService.createCategory(req.body), 201)
export const updateCategory = handle((req) => CategoriesService.updateCategory(req.params.id, req.body))
export const deleteCategory = handle((req) => CategoriesService.deleteCategory(req.params.id))
