import * as ColorsService from '../services/colors.service.js'
import * as SizesService  from '../services/sizes.service.js'

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
