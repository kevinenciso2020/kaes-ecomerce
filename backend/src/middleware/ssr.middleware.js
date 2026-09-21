import crypto from 'node:crypto'

// El frontend (Astro SSR en Vercel) llama al API desde el servidor. Todas esas
// peticiones salen de pocas IPs de Vercel, así que si pasaran por el rate
// limit global por IP, la tienda completa se bloquearía con poco tráfico.
// El frontend se identifica con el header `x-ssr-key` = SSR_API_KEY (secreto
// compartido que sólo existe en las variables de entorno de Vercel y Railway).
export const isTrustedSsrRequest = (req) => {
  const expected = process.env.SSR_API_KEY
  const received = req.headers['x-ssr-key']
  if (!expected || typeof received !== 'string') return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
