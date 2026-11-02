// Middleware de todas las páginas (Cloudflare Worker). En orden:
//   1. www.dominio → dominio (301).
//   2. Caché de páginas públicas en el borde (src/lib/page-cache.js).
//   3. Protección SSR de /admin (abajo).
//   4. Cabeceras de seguridad (src/lib/security-headers.js).
//
// ── Protección SSR de /admin ──
//
// La autorización REAL está en el backend: todos los endpoints /api/v1/admin/*
// exigen un JWT válido con rol ADMIN/SUPER_ADMIN, y las páginas de admin no
// renderizan datos en el servidor (los piden al API desde el navegador). Este
// middleware es una capa adicional para no servir ni el esqueleto del panel a
// quien no tiene sesión.
//
// Cómo verifica: reenvía la cookie `accessToken` a GET /auth/me del backend.
// Así el Worker NO necesita conocer JWT_SECRET.
//
// La cookie sólo es visible aquí si front y API comparten dominio
// (kaes-simplyeternal.co + api.kaes-simplyeternal.co con
// COOKIE_DOMAIN=.kaes-simplyeternal.co en el backend). Mientras el
// front esté en *.workers.dev y el API en *.railway.app la cookie pertenece a
// otro sitio y nunca llega: en ese caso (ADMIN_SSR_GUARD distinto de "strict")
// se deja pasar y la página valida el rol en el cliente contra el backend.

import { applySecurityHeaders, isAdminPath } from './lib/security-headers.js'
import { readCachedPage, storePage } from './lib/page-cache.js'

const isAdminRole = (role) => role === 'ADMIN' || role === 'SUPER_ADMIN'

const readCookie = (header, name) =>
  header?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1)

export const guardAdmin = async (context, next) => {
  const { url, request, locals } = context
  if (!isAdminPath(url.pathname)) return next()

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
    // 401 puede ser sólo el access token vencido (15 min) con refresh válido:
    // fuera de "strict" se deja pasar para que el cliente refresque la sesión.
    if (!res.ok) return strict ? context.redirect(loginUrl) : next()
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

export const onRequest = async (context, next) => {
  const { url, request, locals } = context

  if (url.hostname.startsWith('www.')) {
    const target = new URL(url)
    target.hostname = url.hostname.slice(4)
    return applySecurityHeaders(Response.redirect(target.toString(), 301), url.pathname)
  }

  const cached = await readCachedPage(request, url)
  if (cached) return applySecurityHeaders(cached, url.pathname)

  let response = await guardAdmin(context, next)
  const waitUntil = locals?.cfContext?.waitUntil?.bind(locals.cfContext)
  response = await storePage(request, url, response, waitUntil)
  return applySecurityHeaders(response, url.pathname)
}
