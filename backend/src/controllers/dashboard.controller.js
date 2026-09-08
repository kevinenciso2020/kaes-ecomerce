import * as Dashboard from '../services/dashboard.service.js'

export const getOverview = async (req, res, next) => {
  try {
    const stats = await Dashboard.getOverview()
    res.json(stats)
  } catch (err) { next(err) }
}

export const getSales = async (req, res, next) => {
  try {
    const data = await Dashboard.getSalesSeries(req.query)
    res.json(data)
  } catch (err) { next(err) }
}

export const getTopProducts = async (req, res, next) => {
  try {
    const products = await Dashboard.getTopProducts(req.query)
    res.json({ products })
  } catch (err) { next(err) }
}

export const getByCategory = async (req, res, next) => {
  try {
    const categories = await Dashboard.getSalesByCategory(req.query)
    res.json({ categories })
  } catch (err) { next(err) }
}

export const getRecentOrders = async (req, res, next) => {
  try {
    const orders = await Dashboard.getRecentOrders(req.query)
    res.json({ orders })
  } catch (err) { next(err) }
}

export const getLowStock = async (req, res, next) => {
  try {
    const products = await Dashboard.getLowStock(req.query)
    res.json({ products })
  } catch (err) { next(err) }
}
