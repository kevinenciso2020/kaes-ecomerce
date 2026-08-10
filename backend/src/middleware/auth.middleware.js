import jwt from 'jsonwebtoken'

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
    return res.status(401).json({ error: 'Token requerido' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

// Verifica que el usuario tenga rol de administrador (ADMIN o SUPER_ADMIN)
export const isAdmin = (req, res, next) => {
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN')) {
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' })
  }
  next()
}