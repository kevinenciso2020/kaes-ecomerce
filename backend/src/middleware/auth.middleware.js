import jwt from 'jsonwebtoken'
import { prisma } from '../config/prisma.js'

const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1]
  }
  return req.cookies?.accessToken
}

// Verifica que el token JWT sea válido
export const isAuth = (req, res, next) => {
  const token = getTokenFromRequest(req)

  if (!token) {
    req.log?.warn({ reqId: req.id }, 'auth.token_missing')
    return res.status(401).json({ error: 'Token requerido' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    req.log?.warn({ reqId: req.id, errName: err.name }, 'auth.token_invalid')
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

// Verifica que el usuario tenga rol de administrador (ADMIN o SUPER_ADMIN).
//
// El rol viaja en el access token (dura 15 min). Para que degradar o
// desactivar a un admin tenga efecto inmediato, se confirma contra la BD que
// la cuenta siga activa y con el MISMO rol del token. Si no coincide se
// responde 401: el cliente renueva la sesión (el refresh lee el rol actual de
// la BD) o, si la cuenta fue desactivada/revocada, vuelve a iniciar sesión.
export const isAdmin = async (req, res, next) => {
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN')) {
    req.log?.warn(
      { reqId: req.id, userId: req.user?.id, role: req.user?.role, requiredRole: 'ADMIN' },
      'authz.forbidden'
    )
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' })
  }

  try {
    const current = await prisma.user.findFirst({
      where: { id: req.user.id, isActive: true, role: req.user.role },
      select: { id: true },
    })
    if (!current) {
      req.log?.warn({ reqId: req.id, userId: req.user.id, role: req.user.role }, 'authz.admin_token_outdated')
      return res.status(401).json({ error: 'Tu sesión de administrador ya no es válida, inicia sesión de nuevo', code: 'SESSION_OUTDATED' })
    }
  } catch (err) {
    return next(err)
  }

  next()
}
