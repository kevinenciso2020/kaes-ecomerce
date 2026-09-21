import * as ProductService from '../services/product.service.js'

export const getProducts = async (req, res, next) => {
  try {
    const result = await ProductService.getProducts(req.query)
    // Catálogo público: cacheable 60 s en CDN/navegador.
    res.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300')
    res.json(result)
  } catch (err) { next(err) }
}

export const getProductBySlug = async (req, res, next) => {
  try {
    const product = await ProductService.getProductBySlug(req.params.slug)
    res.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300')
    res.json(product)
  } catch (err) { next(err) }
}

export const getCategories = async (req, res, next) => {
  try {
    const categories = await ProductService.getCategories()
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300')
    res.json(categories)
  } catch (err) { next(err) }
}
