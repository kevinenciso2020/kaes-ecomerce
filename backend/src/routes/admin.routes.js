import { Router } from 'express'
import { validate } from '../middleware/validate.js'
import { adminLimiter } from '../middleware/rateLimit.middleware.js'

import {
  getDashboardStats, createDiscount, createCoupon, getCoupons, getDiscounts,
  getAllUsers, getUserById, updateUser, deleteUser, updateUserRole,
  resetUserPassword, updateCoupon,
} from '../controllers/admin.controller.js'

import {
  listContactMessages, readContactMessage, removeContactMessage,
} from '../controllers/contact.controller.js'

import * as AdminProducts from '../controllers/admin-products.controller.js'
import * as AdminOrders   from '../controllers/admin-orders.controller.js'
import * as Dashboard     from '../controllers/dashboard.controller.js'
import * as Catalog       from '../controllers/catalog.controller.js'

import {
  getAllUsers as getAllUsersValidator,
  getUserById as getUserByIdValidator,
  updateUser as updateUserValidator,
  deleteUser as deleteUserValidator,
  updateUserRole as updateUserRoleValidator,
  resetUserPassword as resetUserPasswordValidator,
  updateCoupon as updateCouponValidator,
  createCoupon as createCouponValidator,
  createDiscount as createDiscountValidator,
} from '../validators/admin.validator.js'

import { getAllContactMessages, markContactMessageRead } from '../validators/contact.validator.js'

import {
  adminListProducts, adminProductId, adminImageId,
  adminCreateProduct, adminUpdateProduct, adminUpsertVariants,
  adminAddImages, adminDeleteProduct, adminCreateColor, adminUpdateColor, adminIdParam,
  adminCreateCategory, adminUpdateCategory,
} from '../validators/admin-products.validator.js'

import {
  adminListOrders, adminOrderId, adminUpdateOrderStatus,
} from '../validators/admin-orders.validator.js'

import {
  dashboardSales, dashboardTopProducts, dashboardRecentOrders, dashboardLowStock,
  catalogSizes,
} from '../validators/dashboard.validator.js'

import { productUpload, uploadConstants } from '../middleware/upload.middleware.js'
import { isAuth, isAdmin } from '../middleware/auth.middleware.js'
import { canManageAdmins } from '../middleware/authorization.middleware.js'

const router = Router()

const adminActionLogger = (req, res, next) => {
  req.log?.info({
    reqId: req.id,
    userId: req.user?.id,
    userRole: req.user?.role,
    ip: req.ip || req.connection?.remoteAddress,
    method: req.method,
    path: req.originalUrl,
  }, 'admin.action')
  next()
}

// Auth primero para que el rate limit cuente por usuario admin, no por IP.
router.use(isAuth, isAdmin, adminLimiter, adminActionLogger)

// ─────────────────────────────────────────
// Stats legacy (mantenido por compat con admin/index.astro que llama /admin/stats)
// ─────────────────────────────────────────
router.get('/stats', getDashboardStats)

// ─────────────────────────────────────────
// Catálogo canónico — colors & sizes
// ─────────────────────────────────────────
router.get   ('/colors',        Catalog.getColors)
router.post  ('/colors',        validate(adminCreateColor),   Catalog.createColor)
router.put   ('/colors/:id',    validate(adminUpdateColor),   Catalog.updateColor)
router.delete('/colors/:id',    validate(adminIdParam),       Catalog.deleteColor)
router.get   ('/sizes',         validate(catalogSizes),       Catalog.getSizes)

router.get   ('/categories',     Catalog.listCategories)
router.post  ('/categories',     validate(adminCreateCategory), Catalog.createCategory)
router.put   ('/categories/:id', validate(adminUpdateCategory), Catalog.updateCategory)
router.delete('/categories/:id', validate(adminIdParam),        Catalog.deleteCategory)

// ─────────────────────────────────────────
// Products — CRUD admin
// multer ANTES del validator para que req.body tenga los datos del form.
// ─────────────────────────────────────────
router.get   ('/products',                            validate(adminListProducts),   AdminProducts.listProducts)
router.get   ('/products/low-stock',                  validate(adminListProducts),   AdminProducts.listLowStock)
router.get   ('/products/:id',                        validate(adminProductId),      AdminProducts.getProductById)
router.post  ('/products',                            productUpload.array('images', uploadConstants.MAX_FILES), validate(adminCreateProduct), AdminProducts.createProduct)
router.put   ('/products/:id',                        productUpload.array('images', uploadConstants.MAX_FILES), validate(adminUpdateProduct), AdminProducts.updateProduct)
router.delete('/products/:id',                        validate(adminDeleteProduct),  AdminProducts.deleteProduct)
router.patch ('/products/:id/restore',                validate(adminProductId),      AdminProducts.restoreProduct)
router.post  ('/products/:id/images',                 productUpload.array('images', uploadConstants.MAX_FILES), validate(adminAddImages), AdminProducts.addProductImages)
router.delete('/products/:id/images/:imageId',        validate(adminProductId), validate(adminImageId), AdminProducts.deleteProductImage)
router.patch ('/products/:id/images/:imageId/main',   validate(adminProductId), validate(adminImageId), AdminProducts.setMainImage)
router.patch ('/products/:id/variants',               validate(adminUpsertVariants), AdminProducts.upsertVariants)

// ─────────────────────────────────────────
// Orders — gestión admin
// ─────────────────────────────────────────
router.get   ('/orders',                            validate(adminListOrders),       AdminOrders.listOrders)
router.get   ('/orders/:id',                        validate(adminOrderId),          AdminOrders.getOrderById)
router.put   ('/orders/:id/status',                 validate(adminUpdateOrderStatus), AdminOrders.updateOrderStatus)
router.patch ('/orders/:id/resolve-review',         validate(adminOrderId),          AdminOrders.resolveReview)

// ─────────────────────────────────────────
// Dashboard — agregaciones
// ─────────────────────────────────────────
router.get('/dashboard/overview',     Dashboard.getOverview)
router.get('/dashboard/sales',        validate(dashboardSales),        Dashboard.getSales)
router.get('/dashboard/top-products', validate(dashboardTopProducts),  Dashboard.getTopProducts)
router.get('/dashboard/by-category',  validate(dashboardSales),        Dashboard.getByCategory)
router.get('/dashboard/recent-orders',validate(dashboardRecentOrders), Dashboard.getRecentOrders)
router.get('/dashboard/low-stock',    validate(dashboardLowStock),     Dashboard.getLowStock)

// ─────────────────────────────────────────
// Discounts & Coupons
// ─────────────────────────────────────────
router.get('/discounts',         getDiscounts)
router.post('/discounts',        validate(createDiscountValidator), createDiscount)
router.get('/coupons',           getCoupons)
router.post('/coupons',          validate(createCouponValidator), createCoupon)
router.put('/coupons/:id',       validate(updateCouponValidator), updateCoupon)

// ─────────────────────────────────────────
// Users
// ─────────────────────────────────────────
router.get('/users',              validate(getAllUsersValidator),         getAllUsers)
router.get('/users/:id',          validate(getUserByIdValidator),         getUserById)
router.put('/users/:id',          validate(updateUserValidator),          updateUser)
router.delete('/users/:id',       validate(deleteUserValidator),         deleteUser)
router.put('/users/:id/role',     validate(updateUserRoleValidator),     canManageAdmins, updateUserRole)
router.put('/users/:id/reset-password', validate(resetUserPasswordValidator), canManageAdmins, resetUserPassword)

// ─────────────────────────────────────────
// Mensajes de contacto
// ─────────────────────────────────────────
router.get('/messages',            validate(getAllContactMessages), listContactMessages)
router.put('/messages/:id/read',   validate(markContactMessageRead), readContactMessage)
router.delete('/messages/:id',     validate(adminIdParam), removeContactMessage)

export default router
