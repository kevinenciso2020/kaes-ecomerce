import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { register, login, refresh, logout, me } from '../controllers/auth.controller.js'
import { isAuth, isAdmin } from '../middleware/auth.middleware.js'
import { canManageAdmins } from '../middleware/authorization.middleware.js'
import { prisma } from '../config/prisma.js'

const router = Router()

router.post('/register', register)
router.post('/login',    login)
router.post('/refresh',  refresh)
router.post('/logout',   logout)
router.get('/me',        isAuth, me)

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