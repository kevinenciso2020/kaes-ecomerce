import crypto from 'node:crypto'

// Integración Addi ("compra ahora, paga después"):
//   1. El backend pide un token OAuth (client_credentials) y crea una
//      "online application" con el TOTAL de la orden. Addi responde con una
//      redirección (header Location) a su flujo de crédito.
//   2. El cliente solicita el crédito en Addi. Si se aprueba, Addi le paga el
//      total a la tienda; el cliente le paga a Addi en cuotas.
//   3. Addi llama a nuestro callback (POST, protegido con Basic auth con el
//      usuario/contraseña que definimos y le entregamos a Addi) con el estado.
//   4. Addi redirige al cliente a /checkout/resultado.
//
// Credenciales (las entrega Addi al activar la cuenta de aliado):
//   ADDI_CLIENT_ID, ADDI_CLIENT_SECRET, ADDI_ALLY_SLUG
//   ADDI_CALLBACK_USER, ADDI_CALLBACK_PASSWORD  (los defines tú y se los pasas a Addi)
//   ADDI_ENV = sandbox | production
//
// ⚠️ Los nombres de campos siguen la documentación pública de Addi para
// aliados. Al activar la cuenta, confirmar contra la documentación que entrega
// Addi (pueden pedir campos extra del cliente, p. ej. el número de documento).

const ENVIRONMENTS = {
  sandbox: {
    auth: 'https://auth.addi-staging.com',
    api: 'https://api.addi-staging.com',
    audience: 'https://api.staging.addi.com',
  },
  production: {
    auth: 'https://auth.addi.com',
    api: 'https://api.addi.com',
    audience: 'https://api.addi.com',
  },
}

const REQUEST_TIMEOUT_MS = 15_000

export const addiEnv = () => (process.env.ADDI_ENV === 'production' ? 'production' : 'sandbox')

const urls = () => {
  const base = ENVIRONMENTS[addiEnv()]
  return {
    ...base,
    auth: process.env.ADDI_AUTH_URL || base.auth,
    api: process.env.ADDI_API_URL || base.api,
    audience: process.env.ADDI_AUDIENCE || base.audience,
  }
}

export const isAddiConfigured = () =>
  Boolean(
    process.env.ADDI_CLIENT_ID &&
    process.env.ADDI_CLIENT_SECRET &&
    process.env.ADDI_ALLY_SLUG &&
    process.env.ADDI_CALLBACK_USER &&
    process.env.ADDI_CALLBACK_PASSWORD,
  )

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const providerError = (message, status) =>
  Object.assign(new Error(message), { status: 502, code: 'ADDI_UNAVAILABLE', providerStatus: status })

// Token en memoria hasta 1 minuto antes de que expire.
let tokenCache = { token: null, expiresAt: 0 }

export const resetTokenCache = () => {
  tokenCache = { token: null, expiresAt: 0 }
}

export const getToken = async () => {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token

  const { auth, audience } = urls()
  const res = await fetchWithTimeout(`${auth}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audience,
      grant_type: 'client_credentials',
      client_id: process.env.ADDI_CLIENT_ID,
      client_secret: process.env.ADDI_CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw providerError('No se pudo autenticar con Addi', res.status)

  const data = await res.json()
  if (!data?.access_token) throw providerError('Addi no devolvió un token', res.status)
  const ttlSeconds = Number(data.expires_in) || 3600
  tokenCache = { token: data.access_token, expiresAt: Date.now() + Math.max(ttlSeconds - 60, 30) * 1000 }
  return tokenCache.token
}

const splitName = (fullName = '') => {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { firstName: parts[0] || 'Cliente', lastName: parts[0] || 'Cliente' }
  const half = Math.ceil(parts.length / 2)
  return { firstName: parts.slice(0, half).join(' '), lastName: parts.slice(half).join(' ') }
}

/**
 * Arma el cuerpo de la solicitud. Se envía UN ítem por el total de la orden
 * (igual que con MercadoPago) para que el monto financiado sea exactamente el
 * total calculado por el servidor, con descuentos, cupón y envío.
 */
export const buildApplicationBody = ({ order, callbackUrl, redirectionUrl, logoUrl }) => {
  const shortId = order.id.slice(-8).toUpperCase()
  const total = Math.round(Number(order.total))
  const fullName = order.shippingAddress?.fullName || order.buyerName || order.user?.name || ''
  const { firstName, lastName } = splitName(fullName)
  const phone = (order.shippingAddress?.phone || '').replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '')
  const address = order.shippingAddress
    ? {
        lineOne: order.shippingAddress.street,
        city: order.shippingAddress.municipio || order.shippingAddress.city,
        country: 'CO',
      }
    : undefined

  return {
    orderId: order.id,
    totalAmount: total,
    shippingAmount: Math.round(Number(order.shipping || 0)),
    totalTaxesAmount: 0,
    currency: 'COP',
    items: [{
      sku: order.id,
      name: `Pedido KAES #${shortId}`,
      quantity: 1,
      unitPrice: total,
      tax: 0,
      category: 'ropa',
    }],
    client: {
      ...(order.buyerDocNumber ? { idType: order.buyerDocType === '31' ? 'NIT' : 'CC', idNumber: order.buyerDocNumber } : {}),
      firstName,
      lastName,
      email: order.user?.email,
      ...(phone ? { cellphone: phone, cellphoneCountryCode: '+57' } : {}),
      ...(address ? { address } : {}),
    },
    ...(address ? { shippingAddress: address } : {}),
    allyUrlRedirection: {
      ...(logoUrl ? { logoUrl } : {}),
      callbackUrl,
      redirectionUrl,
    },
  }
}

/**
 * Crea la solicitud de crédito y devuelve la URL a la que se redirige al
 * cliente. Addi responde 301/302 con header Location.
 */
export const createApplication = async (params) => {
  const token = await getToken()
  const res = await fetchWithTimeout(`${urls().api}/v1/online-applications`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(buildApplicationBody(params)),
  })

  const location = res.headers.get('location')
  if (location && (res.status >= 300 && res.status < 400)) return location
  // Algunas versiones responden 200/201 con la URL en el cuerpo.
  if (res.ok) {
    const data = await res.json().catch(() => null)
    const url = data?.redirectionUrl || data?.url || data?.location
    if (url) return url
  }
  throw providerError('Addi no devolvió el enlace de pago', res.status)
}

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/** Valida el header Authorization: Basic … que envía Addi en el callback. */
export const verifyCallbackAuth = (authorization) => {
  const user = process.env.ADDI_CALLBACK_USER
  const password = process.env.ADDI_CALLBACK_PASSWORD
  if (!user || !password) return { valid: false, reason: 'callback_credentials_missing' }

  const match = /^Basic\s+(.+)$/i.exec(authorization || '')
  if (!match) return { valid: false, reason: 'authorization_missing' }

  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const sep = decoded.indexOf(':')
  if (sep < 0) return { valid: false, reason: 'authorization_malformed' }

  const okUser = safeEqual(decoded.slice(0, sep), user)
  const okPass = safeEqual(decoded.slice(sep + 1), password)
  return okUser && okPass ? { valid: true } : { valid: false, reason: 'authorization_invalid' }
}

/**
 * Montos mínimo/máximo que Addi financia para este aliado (para ocultar Addi
 * si el total no aplica). Devuelve null si no se pudo consultar.
 */
export const getAmountLimits = async (amount) => {
  try {
    const slug = encodeURIComponent(process.env.ADDI_ALLY_SLUG || '')
    const res = await fetchWithTimeout(`${urls().api}/allies/${slug}/config?requestedamount=${Math.round(Number(amount) || 0)}`)
    if (!res.ok) return null
    const data = await res.json()
    const min = Number(data?.minAmount)
    const max = Number(data?.maxAmount)
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null
  } catch {
    return null
  }
}
