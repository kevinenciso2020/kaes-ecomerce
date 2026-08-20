import * as AdminService from '../services/admin.service.js'

export const getAllUsers = async (req, res, next) => {
  try {
    const result = await AdminService.getAllUsers(req.query)
    res.json(result)
  } catch (err) { next(err) }
}

export const getUserById = async (req, res, next) => {
  try {
    const user = await AdminService.getUserById(req.params.id)
    res.json(user)
  } catch (err) { next(err) }
}

export const updateUser = async (req, res, next) => {
  try {
    const user = await AdminService.updateUser(req.params.id, req.body)
    res.json(user)
  } catch (err) { next(err) }
}

export const deleteUser = async (req, res, next) => {
  try {
    const hard = req.query.hard === 'true' || req.body?.hard === true
    const user = await AdminService.deleteUser(req.params.id, { hard })
    res.json({ ...user, hardDelete: hard })
  } catch (err) { next(err) }
}

export const updateUserRole = async (req, res, next) => {
  try {
    const user = await AdminService.updateUserRole(req.params.id, req.body.role)
    res.json(user)
  } catch (err) { next(err) }
}

export const getAllProducts = async (req, res, next) => {
  try {
    const result = await AdminService.getAllProducts(req.query)
    res.json(result)
  } catch (err) { next(err) }
}

export const getAllOrders = async (req, res, next) => {
  try {
    const result = await AdminService.getAllOrders(req.query)
    res.json(result)
  } catch (err) { next(err) }
}

export const updateOrderStatus = async (req, res, next) => {
  try {
    const order = await AdminService.updateOrderStatus(req.params.id, req.body.status)
    res.json(order)
  } catch (err) { next(err) }
}

export const createDiscount = async (req, res, next) => {
  try {
    const discount = await AdminService.createDiscount(req.body)
    res.status(201).json(discount)
  } catch (err) { next(err) }
}

export const createCoupon = async (req, res, next) => {
  try {
    const coupon = await AdminService.createCoupon(req.body)
    res.status(201).json(coupon)
  } catch (err) { next(err) }
}

export const getCoupons = async (req, res, next) => {
  try {
    const coupons = await AdminService.getCoupons()
    res.json(coupons)
  } catch (err) { next(err) }
}

export const updateCoupon = async (req, res, next) => {
  try {
    const coupon = await AdminService.updateCoupon(req.params.id, req.body)
    res.json(coupon)
  } catch (err) { next(err) }
}

export const getDiscounts = async (req, res, next) => {
  try {
    const discounts = await AdminService.getDiscounts()
    res.json(discounts)
  } catch (err) { next(err) }
}

export const getDashboardStats = async (req, res, next) => {
  try {
    const stats = await AdminService.getDashboardStats()
    res.json(stats)
  } catch (err) { next(err) }
}
