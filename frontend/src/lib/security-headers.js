// Cabeceras de seguridad de todas las respuestas del sitio.
//
// Las páginas (SSR) las reciben desde src/middleware.js. Los archivos estáticos
// (public/ y /_astro/*) los sirve Cloudflare sin pasar por el Worker y toman
// las mismas cabeceras de public/_headers: si cambias algo aquí, cámbialo allá.
//
// La CSP completa va en un <meta> que genera Astro (astro.config.mjs); aquí sólo
// lo que no puede ir en <meta>, como frame-ancestors.

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy':
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.wompi.co https://www.mercadopago.com.co",
}

// El panel nunca se cachea ni se indexa.
export const ADMIN_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
}

export const isAdminPath = (pathname) => pathname === '/admin' || pathname.startsWith('/admin/')

// Devuelve la respuesta con `headers` aplicadas. Las respuestas que vienen de
// fetch() o de la Cache API tienen cabeceras inmutables: en ese caso se copia.
export const withHeaders = (response, headers) => {
  const apply = (res) => {
    for (const [key, value] of Object.entries(headers)) res.headers.set(key, value)
    return res
  }
  try {
    return apply(response)
  } catch {
    return apply(new Response(response.body, response))
  }
}

export const applySecurityHeaders = (response, pathname) =>
  withHeaders(response, isAdminPath(pathname) ? { ...SECURITY_HEADERS, ...ADMIN_HEADERS } : SECURITY_HEADERS)
