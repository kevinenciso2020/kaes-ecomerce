import { Router } from 'express'
import {
  register,
  login,
  refresh,
  logout,
  me,
  verifyEmail,
  resendVerification,
  checkVerification,
  forgotPassword,
  resetPassword,
} from '../controllers/auth.controller.js'
import { isAuth } from '../middleware/auth.middleware.js'
import { validate } from '../middleware/validate.js'
import {
  authLoginLimiter,
  authRegisterLimiter,
  authRefreshLimiter,
  emailVerifyLimiter,
  passwordResetRequestLimiter,
  passwordResetConfirmLimiter,
  authIpLimiter,
  loginIpLimiter,
} from '../middleware/rateLimit.middleware.js'
import {
  register as registerValidator,
  login as loginValidator,
  resendVerification as resendVerificationValidator,
  forgotPassword as forgotPasswordValidator,
  resetPassword as resetPasswordValidator,
} from '../validators/auth.validator.js'

const router = Router()

router.post('/register',            authIpLimiter, authRegisterLimiter, validate(registerValidator), register)
router.post('/login',               loginIpLimiter, authLoginLimiter,    validate(loginValidator),    login)
router.post('/refresh',             authRefreshLimiter,  refresh)
router.post('/logout',              logout)
router.get('/me',                   isAuth,              me)

// Verificación de email — pública (el link del correo no requiere login)
router.get('/verify-email',         verifyEmail)
router.post('/resend-verification', authIpLimiter, emailVerifyLimiter, validate(resendVerificationValidator), resendVerification)
router.get('/verification-status',  isAuth,              checkVerification)

// Recuperación de contraseña por OTP — público, rate-limited
router.post('/forgot-password',     authIpLimiter, passwordResetRequestLimiter, validate(forgotPasswordValidator), forgotPassword)
router.post('/reset-password',      passwordResetConfirmLimiter, validate(resetPasswordValidator),  resetPassword)

// La gestión de roles vive en /api/v1/admin/users/:id/role (sólo SUPER_ADMIN).

export default router
