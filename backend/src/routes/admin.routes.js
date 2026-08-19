import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { validate } from '../middleware/validate.js'
import { 
  getAllProducts, getAllOrders, updateOrderStatus, createDiscount, 
  createCoupon, getCoupons, getDiscounts, getDashboardStats,
  getAllUsers, getUserById, updateUser, deleteUser, updateUserRole
} from '../controllers/admin.controller.js'
import { 
  getAllUsers as getAllUsersValidator, getUserById as getUserByIdValidator,
  updateUser as updateUserValidator, deleteUser as deleteUserValidator,
  updateUserRole as updateUserRoleValidator
} from '../validators/admin.validator.js'
import { isAuth, isAdmin } from '../middleware/auth.middleware.js'
import { canManageAdmins } from '../middleware/authorization.middleware.js'

const router = Router()

// Rate limiting específico para admin - más restrictivo que el global
// Máximo 30 peticiones por 15 minutos por IP
const adminRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Demasiadas peticiones de admin, intenta más tarde' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Middleware de logging para acciones administrativas
const adminActionLogger = (req, res, next) => {
  const timestamp = new Date().toISOString()
  console.log(`[ADMIN ACTION] ${timestamp} | User: ${req.user?.id || 'unknown'} | IP: ${req.ip || req.connection.remoteAddress} | Method: ${req.method} | Path: ${req.originalUrl}`)
  next()
}

// Todas las rutas de admin requieren: rate limit + auth + rol admin + logging
router.use(adminRateLimiter, isAuth, isAdmin, adminActionLogger)

router.get('/stats',              getDashboardStats)
router.get('/products',           getAllProducts)
router.get('/orders',             getAllOrders)
router.put('/orders/:id/status',  updateOrderStatus)
router.get('/discounts',          getDiscounts)
router.post('/discounts',         createDiscount)
router.get('/coupons',            getCoupons)
router.post('/coupons',          createCoupon)

router.get('/users',              validate(getAllUsersValidator), getAllUsers)
router.get('/users/:id',          validate(getUserByIdValidator), getUserById)
router.put('/users/:id',          validate(updateUserValidator), updateUser)
router.delete('/users/:id',       validate(deleteUserValidator), deleteUser)
router.put('/users/:id/role',     validate(updateUserRoleValidator), canManageAdmins, updateUserRole)

export default router