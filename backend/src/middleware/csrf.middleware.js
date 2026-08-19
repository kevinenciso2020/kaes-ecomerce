// CSRF protection — `sameSite: 'none'` en los cookies de auth debilita la
// defensa que el navegador aporta contra cross-site request forgery. Este
// middleware compensa exigiendo que las requests "state-changing" lleguen
// con un `Origin` (o `Referer` como fallback) que pertenezca a la lista de
// orígenes permitidos.
//
// Reglas:
//   • Sólo aplica a métodos que modifican estado (POST, PUT, PATCH, DELETE).
//   • GET, HEAD y OPTIONS siguen libres (los cookies `httpOnly` no son
//     suficientes para exfiltrar, y los webhooks externos llaman por GET).
//   • Los webhooks de payments quedan exceptuados porque llegan desde los
//     servidores de Stripe / MercadoPago / Wompi, no desde un navegador.
//   • Si la request no trae `Origin` ni `Referer` (curl, server-to-server),
//     se rechaza salvo que venga de un webhook.

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const WEBHOOK_PATHS = [
  '/api/v1/payments/webhook',
  '/api/v1/payments/wompi/webhook',
]

const isWebhook = (req) => WEBHOOK_PATHS.some((p) => req.path.startsWith(p))

const allowedOrigins = () => [
  process.env.FRONTEND_URL,
  'http://localhost:4321',
  'http://127.0.0.1:4321',
]

const originFromUrl = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

const extractOrigin = (req) => {
  const origin = req.headers.origin
  if (origin) return origin

  const referer = req.headers.referer || req.headers.referrer
  if (referer) return originFromUrl(referer)

  return null
}

export const csrfProtection = (req, res, next) => {
  if (process.env.NODE_ENV === 'test') return next()
  if (!STATE_CHANGING.has(req.method)) return next()
  if (isWebhook(req)) return next()

  // /auth/refresh también puede ser CSRF, pero ya está protegido: la
  // rotación compara contra el refresh token en DB. Si alguien lograra
  // refrescarlo igual tendría que conocer el token, lo cual es absurdo.
  // Aún así, lo bloqueamos para mantener defensa en profundidad.
  const requestOrigin = extractOrigin(req)
  if (!requestOrigin) {
    req.log?.warn({ reqId: req.id, method: req.method, path: req.path, ip: req.ip }, 'csrf.origin_missing')
    return res.status(403).json({ error: 'Origen requerido' })
  }

  const allowed = allowedOrigins()
  if (!allowed.includes(requestOrigin)) {
    req.log?.warn({ reqId: req.id, method: req.method, path: req.path, ip: req.ip, origin: requestOrigin }, 'csrf.origin_rejected')
    return res.status(403).json({ error: 'Origen no permitido por CSRF' })
  }

  next()
}
