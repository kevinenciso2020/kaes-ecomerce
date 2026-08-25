import jwt from 'jsonwebtoken'

const ADMIN_ROUTES = ['/admin']

const isAdminRole = (role) => {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

export const onRequest = async (context, next) => {
  const { url, request, locals } = context

  const path = url.pathname
  const isAdminRoute = ADMIN_ROUTES.some(route => path.startsWith(route))

  if (!isAdminRoute) {
    return next()
  }

  const JWT_SECRET = process.env.JWT_SECRET

  // Fail-closed: si falta la variable de entorno no dejamos pasar,
  // bloqueamos el acceso a /admin. Antes esto hacía `next()` y dejaba
  // pasar a cualquiera sin login si la env var no estaba seteada.
  if (!JWT_SECRET) {
    console.error('middleware.admin: JWT_SECRET no está definida — bloqueando acceso a /admin')
    return context.redirect('/auth/login')
  }

  const token = request.headers.get('cookie')?.match(/accessToken=([^;]+)/)?.[1]

  if (!token) {
    return context.redirect('/auth/login')
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)

    if (!isAdminRole(decoded.role)) {
      return context.redirect('/auth/login')
    }

    locals.user = decoded
    locals.isAdmin = true
    locals.isSuperAdmin = decoded.role === 'SUPER_ADMIN'

    return next()
  } catch (err) {
    return context.redirect('/auth/login')
  }
}