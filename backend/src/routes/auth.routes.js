import { Router } from 'express'
import bcrypt from 'bcryptjs'
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
import { isAuth, isAdmin } from '../middleware/auth.middleware.js'
import { canManageAdmins } from '../middleware/authorization.middleware.js'
import { validate } from '../middleware/validate.js'
import {
  authLoginLimiter,
  authRegisterLimiter,
  authRefreshLimiter,
  emailVerifyLimiter,
  passwordResetRequestLimiter,
  passwordResetConfirmLimiter,
} from '../middleware/rateLimit.middleware.js'
import {
  resendVerification as resendVerificationValidator,
  forgotPassword as forgotPasswordValidator,
  resetPassword as resetPasswordValidator,
} from '../validators/auth.validator.js'
import { prisma } from '../config/prisma.js'

const router = Router()

router.post('/register',            authRegisterLimiter, register)
router.post('/login',               authLoginLimiter,    login)
router.post('/refresh',             authRefreshLimiter,  refresh)
router.post('/logout',              logout)
router.get('/me',                   isAuth,              me)

// Verificación de email — pública (el link del correo no requiere login)
router.get('/verify-email',         verifyEmail)
router.post('/resend-verification', emailVerifyLimiter, validate(resendVerificationValidator), resendVerification)
router.get('/verification-status',  isAuth,              checkVerification)

// Recuperación de contraseña por OTP — público, rate-limited
router.post('/forgot-password',     passwordResetRequestLimiter, validate(forgotPasswordValidator), forgotPassword)
router.post('/reset-password',      passwordResetConfirmLimiter, validate(resetPasswordValidator),  resetPassword)

router.get('/admins', isAuth, isAdmin, async (req, res) => {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, email: true, name: true, role: true }
  })
  res.json(admins)
})

router.post('/make-admin', isAuth, isAdmin, canManageAdmins, async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email requerido' })
  try {
    const user = await prisma.user.update({
      where: { email },
      data: { role: 'ADMIN' },
      select: { id: true, email: true, name: true, role: true }
    })
    res.json({ message: 'Usuario ahora es ADMIN', user })
  } catch (e) {
    res.status(404).json({ error: 'Usuario no encontrado' })
  }
})

router.post('/reset-password', isAuth, isAdmin, canManageAdmins, async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' })
  try {
    const hashedPassword = await bcrypt.hash(password, 12)
    const user = await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
      select: { id: true, email: true, name: true, role: true }
    })
    res.json({ message: 'Contraseña actualizada', user })
  } catch (e) {
    res.status(404).json({ error: 'Usuario no encontrado' })
  }
})

export default router