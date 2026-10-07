import crypto from 'node:crypto'
import { MercadoPagoConfig } from 'mercadopago'

// MercadoPago es opcional: si MP_ACCESS_TOKEN no está configurado la app arranca
// igual y los endpoints de MP responden 503.
export const isMercadoPagoConfigured = () => Boolean(process.env.MP_ACCESS_TOKEN)

let client = null
export const getMpClient = () => {
  if (!isMercadoPagoConfigured()) return null
  if (!client) {
    client = new MercadoPagoConfig({
      accessToken: process.env.MP_ACCESS_TOKEN,
      options: { timeout: 10000 },
    })
  }
  return client
}

/**
 * Verifica el header x-signature de un webhook de MercadoPago.
 * Docs: manifest = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 *  - data.id viene en el QUERY (?data.id=123), no en req.query.id.
 *  - si data.id es alfanumérico se usa en minúsculas.
 *  - las partes cuyo valor no llega se omiten del manifest.
 * HMAC-SHA256 con la "clave secreta" de Webhooks (MP_WEBHOOK_SECRET).
 */
export const verifyMpSignature = ({ xSignature, xRequestId, dataId }) => {
  const secret = process.env.MP_WEBHOOK_SECRET
  if (!secret) return { valid: false, reason: 'secret_missing' }
  if (!xSignature) return { valid: false, reason: 'signature_missing' }

  let ts
  let v1
  for (const part of String(xSignature).split(',')) {
    const [key, ...rest] = part.split('=')
    const value = rest.join('=').trim()
    if (key.trim() === 'ts') ts = value
    if (key.trim() === 'v1') v1 = value
  }
  if (!ts || !v1) return { valid: false, reason: 'signature_malformed' }

  let manifest = ''
  if (dataId) manifest += `id:${String(dataId).toLowerCase()};`
  if (xRequestId) manifest += `request-id:${xRequestId};`
  manifest += `ts:${ts};`

  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(v1.toLowerCase(), 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'signature_invalid' }
  }
  return { valid: true }
}

export default getMpClient
