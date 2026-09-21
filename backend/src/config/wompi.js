import crypto from 'node:crypto'
import axios from 'axios'

// Integración Wompi por Web Checkout:
//   1. El backend arma la URL de https://checkout.wompi.co/p/ con una firma de
//      integridad SHA256(reference + amountInCents + currency + integritySecret).
//   2. El cliente paga en Wompi (tarjeta, PSE, Nequi, Bancolombia…).
//   3. Wompi notifica al webhook con un evento firmado (checksum SHA256).
//   4. Wompi redirige al cliente a /checkout/resultado, que consulta el estado.
//
// Llaves (panel de Wompi → Desarrolladores):
//   WOMPI_PUBLIC_KEY        pub_test_… / pub_prod_…
//   WOMPI_PRIVATE_KEY       prv_test_… / prv_prod_…   (consultas server-to-server)
//   WOMPI_INTEGRITY_SECRET  test_integrity_… / prod_integrity_…
//   WOMPI_EVENTS_SECRET     test_events_… / prod_events_…   (antes WOMPI_WEBHOOK_SECRET)

const CHECKOUT_URL = 'https://checkout.wompi.co/p/'

const apiBaseUrl = () => {
  const key = process.env.WOMPI_PUBLIC_KEY || ''
  const env = process.env.WOMPI_ENV || (key.startsWith('pub_prod_') ? 'production' : 'sandbox')
  return env === 'production' ? 'https://production.wompi.co/v1' : 'https://sandbox.wompi.co/v1'
}

export const eventsSecret = () => process.env.WOMPI_EVENTS_SECRET || process.env.WOMPI_WEBHOOK_SECRET

export const isWompiConfigured = () =>
  Boolean(process.env.WOMPI_PUBLIC_KEY && process.env.WOMPI_INTEGRITY_SECRET && eventsSecret())

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex')

export const integritySignature = ({ reference, amountInCents, currency = 'COP', expirationTime }) => {
  const secret = process.env.WOMPI_INTEGRITY_SECRET
  if (!secret) throw new Error('WOMPI_INTEGRITY_SECRET no configurada')
  // Si se envía expiration-time, Wompi exige incluirla en la firma.
  const base = `${reference}${amountInCents}${currency}${expirationTime || ''}${secret}`
  return sha256(base)
}

/**
 * Referencia única por intento de pago. Wompi no permite reutilizar una
 * referencia, así que un reintento del mismo pedido genera otra.
 * Formato: KAES-<orderId>-<timestamp base36>  (los cuid no tienen guiones)
 */
export const buildReference = (orderId) => `KAES-${orderId}-${Date.now().toString(36)}`

export const orderIdFromReference = (reference) => {
  if (typeof reference !== 'string') return null
  const match = /^KAES-([a-z0-9]+)-[a-z0-9]+$/i.exec(reference)
  if (match) return match[1]
  // Compatibilidad con referencias antiguas "ORDER-<id>"
  const legacy = /^ORDER-([a-z0-9]+)$/i.exec(reference)
  return legacy ? legacy[1] : null
}

export const buildCheckoutUrl = ({ reference, amountInCents, currency = 'COP', redirectUrl, customerEmail, customerName, customerPhone, expirationTime }) => {
  const publicKey = process.env.WOMPI_PUBLIC_KEY
  if (!publicKey) throw new Error('WOMPI_PUBLIC_KEY no configurada')

  const params = new URLSearchParams()
  params.set('public-key', publicKey)
  params.set('currency', currency)
  params.set('amount-in-cents', String(amountInCents))
  params.set('reference', reference)
  params.set('signature:integrity', integritySignature({ reference, amountInCents, currency, expirationTime }))
  if (redirectUrl) params.set('redirect-url', redirectUrl)
  if (expirationTime) params.set('expiration-time', expirationTime)
  if (customerEmail) params.set('customer-data:email', customerEmail)
  if (customerName) params.set('customer-data:full-name', customerName)
  if (customerPhone) {
    params.set('customer-data:phone-number', customerPhone.replace(/\D/g, ''))
    params.set('customer-data:phone-number-prefix', '+57')
  }
  return `${CHECKOUT_URL}?${params.toString()}`
}

const getPath = (obj, path) =>
  path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)

/**
 * Verifica la firma de un evento de Wompi.
 * checksum = SHA256( valores de signature.properties (en orden, tomados de event.data)
 *                    + event.timestamp + events_secret )
 * Se compara con event.signature.checksum (o el header X-Event-Checksum).
 */
export const verifyEventChecksum = (event, headerChecksum) => {
  const secret = eventsSecret()
  if (!secret) return { valid: false, reason: 'events_secret_missing' }

  const properties = event?.signature?.properties
  const received = (event?.signature?.checksum || headerChecksum || '').toLowerCase()
  if (!Array.isArray(properties) || properties.length === 0 || !received || event?.timestamp == null) {
    return { valid: false, reason: 'signature_missing' }
  }

  const values = properties.map((prop) => {
    const v = getPath(event.data, prop)
    return v == null ? '' : String(v)
  })
  const expected = sha256(`${values.join('')}${event.timestamp}${secret}`)

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(received, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'signature_invalid' }
  }
  return { valid: true }
}

const client = () =>
  axios.create({
    baseURL: apiBaseUrl(),
    timeout: 10_000,
    headers: process.env.WOMPI_PRIVATE_KEY
      ? { Authorization: `Bearer ${process.env.WOMPI_PRIVATE_KEY}` }
      : {},
  })

/** Consulta una transacción directamente en Wompi (fuente de verdad). */
export const getTransaction = async (transactionId) => {
  const response = await client().get(`/transactions/${encodeURIComponent(transactionId)}`)
  return response.data?.data
}

/** Busca transacciones por referencia (requiere llave privada). */
export const findTransactionsByReference = async (reference) => {
  const response = await client().get('/transactions', { params: { reference } })
  return response.data?.data || []
}

export default {
  buildCheckoutUrl,
  buildReference,
  orderIdFromReference,
  verifyEventChecksum,
  getTransaction,
  findTransactionsByReference,
  isWompiConfigured,
}
