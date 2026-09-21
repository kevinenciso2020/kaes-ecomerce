// Protección SSR de /admin.
//
// La autorización REAL está en el backend: todos los endpoints /api/v1/admin/*
// exigen un JWT válido con rol ADMIN/SUPER_ADMIN, y las páginas de admin no
// renderizan datos en el servidor (los piden al API desde el navegador). Este
// middleware es una capa adicional para no servir ni el esqueleto del panel a
// quien no tiene sesión.
//
// Cómo verifica: reenvía la cookie `accessToken` a GET /auth/me del backend.
// Así Vercel NO necesita conocer JWT_SECRET.
//
// La cookie sólo es visible aquí si front y API comparten dominio
// (kaes.co + api.kaes.co con COOKIE_DOMAIN=.kaes.co en el backend). Mientras el
// front esté en *.vercel.app y el API en *.railway.app la cookie pertenece a
// otro sitio y nunca llega: en ese caso (ADMIN_SSR_GUARD distinto de "strict")
// se deja pasar y la página valida el rol en el cliente contra el backend.

const ADMIN_PREFIX = '/admin'

const isAdminRole = (role) => role === 'ADMIN' || role === 'SUPER_ADMIN'

const readCookie = (header, name) =>
  header?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1)

export const onRequest = async (context, next) => {
  const { url, request, locals } = context
  if (!url.pathname.startsWith(ADMIN_PREFIX)) return next()

  const strict = process.env.ADMIN_SSR_GUARD === 'strict'
  const apiUrl = (import.meta.env.PUBLIC_API_URL || '').replace(/\/$/, '')
  const token = readCookie(request.headers.get('cookie'), 'accessToken')
  const loginUrl = `/auth/login?redirect=${encodeURIComponent(url.pathname)}`

  if (!token) {
    return strict ? context.redirect(loginUrl) : next()
  }

  try {
    const res = await fetch(`${apiUrl}/auth/me`, {
      headers: {
        cookie: `accessToken=${token}`,
        ...(process.env.SSR_API_KEY ? { 'x-ssr-key': process.env.SSR_API_KEY } : {}),
      },
    })
    if (!res.ok) return context.redirect(loginUrl)
    const { user } = await res.json()
    if (!isAdminRole(user?.role)) return context.redirect('/')

    locals.user = user
    locals.isAdmin = true
    locals.isSuperAdmin = user.role === 'SUPER_ADMIN'
    return next()
  } catch (err) {
    console.error('middleware.admin: no se pudo verificar la sesión', err)
    return strict ? context.redirect(loginUrl) : next()
  }
}
