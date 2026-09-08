import * as AdminProducts from '../services/admin-products.service.js'

export const listProducts = async (req, res, next) => {
  try {
    const result = await AdminProducts.listProducts(req.query)
    res.json(result)
  } catch (err) { next(err) }
}

export const getProductById = async (req, res, next) => {
  try {
    const product = await AdminProducts.getProductById(req.params.id)
    res.json(product)
  } catch (err) { next(err) }
}

export const listLowStock = async (req, res, next) => {
  try {
    const products = await AdminProducts.listLowStock(req.query)
    res.json({ products })
  } catch (err) { next(err) }
}

export const createProduct = async (req, res, next) => {
  try {
    const product = await AdminProducts.createProduct(req.body, req.files)
    res.status(201).json(product)
  } catch (err) { next(err) }
}

export const updateProduct = async (req, res, next) => {
  try {
    const product = await AdminProducts.updateProduct(req.params.id, req.body, req.files)
    res.json(product)
  } catch (err) { next(err) }
}

export const deleteProduct = async (req, res, next) => {
  try {
    const result = await AdminProducts.deleteProduct(req.params.id)
    res.json(result)
  } catch (err) { next(err) }
}

export const deleteProductImage = async (req, res, next) => {
  try {
    const result = await AdminProducts.deleteProductImage(req.params.id, req.params.imageId)
    res.json(result)
  } catch (err) { next(err) }
}

export const setMainImage = async (req, res, next) => {
  try {
    const product = await AdminProducts.setMainImage(req.params.id, req.params.imageId)
    res.json(product)
  } catch (err) { next(err) }
}

export const upsertVariants = async (req, res, next) => {
  try {
    const product = await AdminProducts.upsertVariants(req.params.id, req.body.variants)
    res.json(product)
  } catch (err) { next(err) }
}
