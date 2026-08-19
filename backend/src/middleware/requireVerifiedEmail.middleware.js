// Middleware que bloquea acciones sensibles si el usuario no verificó su email.
// Los admins pueden saltarse el check (operaciones internas de la tienda).
export const requireVerifiedEmail = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Autenticación requerida' })
  }

  if (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') {
    return next()
  }

  if (!req.user.emailVerified) {
    return res.status(403).json({
      error: 'Debes verificar tu correo electrónico antes de realizar esta acción',
      code: 'EMAIL_NOT_VERIFIED',
    })
  }

  next()
}