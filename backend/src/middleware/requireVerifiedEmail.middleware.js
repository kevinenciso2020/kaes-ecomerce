import { prisma } from '../config/prisma.js'

// Middleware que bloquea acciones sensibles si el usuario no verificó su email.
// Los admins pueden saltarse el check (operaciones internas de la tienda).
//
// El claim `emailVerified` del access token puede estar desactualizado (el
// usuario verificó hace un momento y su token es anterior). Si el token dice
// false se confirma contra la BD antes de bloquear.
export const requireVerifiedEmail = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Autenticación requerida' })
  }

  if (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') {
    return next()
  }

  if (req.user.emailVerified) return next()

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { emailVerified: true, isActive: true },
    })
    if (user?.emailVerified && user.isActive !== false) {
      req.user.emailVerified = true
      return next()
    }
  } catch (err) {
    return next(err)
  }

  return res.status(403).json({
    error: 'Debes verificar tu correo electrónico antes de realizar esta acción',
    code: 'EMAIL_NOT_VERIFIED',
  })
}
