// Configuración de facturación electrónica DIAN (software propio), desde env.
// Ver docs/FACTURACION_ELECTRONICA.md para el significado de cada variable.
import { X509Certificate, createPrivateKey } from 'node:crypto'
import { resolveLocation } from './divipola.js'
import { computeNitDv } from './nit.js'

const env = (k, def = '') => (process.env[k] ?? def).toString().trim()

export const isEnabled = () => env('EINVOICE_ENABLED').toLowerCase() === 'true'

const decodePem = (b64) => {
  if (!b64) return ''
  const text = b64.includes('-----BEGIN') ? b64 : Buffer.from(b64, 'base64').toString('utf8')
  return text.replace(/\\n/g, '\n')
}

let cachedCert = null
const loadCertificate = () => {
  const certPem = decodePem(env('EINVOICE_CERT_PEM_BASE64'))
  const keyPem = decodePem(env('EINVOICE_KEY_PEM_BASE64'))
  if (!certPem || !keyPem) return null
  const cacheKey = certPem.length + ':' + keyPem.length
  if (cachedCert?.cacheKey === cacheKey) return cachedCert
  // El primer certificado es el del firmante; los siguientes (opcionales) la cadena.
  const pems = certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
  const chain = pems.map((p) => new X509Certificate(p))
  const privateKey = createPrivateKey({ key: keyPem, passphrase: env('EINVOICE_KEY_PASSPHRASE') || undefined })
  cachedCert = { cacheKey, certificate: chain[0], chain, privateKey }
  return cachedCert
}

/**
 * Devuelve la configuración completa o lanza un error con todo lo que falta.
 * No se llama al arrancar: solo al emitir, para no bloquear la tienda.
 */
export const getConfig = () => {
  const errors = []
  const req = (k) => {
    const v = env(k)
    if (!v) errors.push(k)
    return v
  }

  const environment = env('EINVOICE_ENV', '2')
  if (!['1', '2'].includes(environment)) errors.push('EINVOICE_ENV (1 = producción, 2 = habilitación)')

  // Acepta "900123456", "900.123.456" o "900123456-7" (con DV, que se valida).
  const rawNit = req('EINVOICE_ISSUER_NIT').replace(/[.\s]/g, '')
  const nitMatch = /^(\d{5,15})(?:-(\d))?$/.exec(rawNit)
  if (rawNit && !nitMatch) errors.push('EINVOICE_ISSUER_NIT (solo dígitos, opcionalmente con -DV)')
  const nit = nitMatch?.[1] ?? ''
  const givenDv = nitMatch?.[2] || env('EINVOICE_ISSUER_DV')
  const dv = computeNitDv(nit)
  if (nit && givenDv && givenDv !== dv) errors.push('El DV del NIT del emisor no corresponde (EINVOICE_ISSUER_NIT / EINVOICE_ISSUER_DV)')

  const departamento = req('EINVOICE_ISSUER_DEPARTAMENTO')
  const municipio = req('EINVOICE_ISSUER_MUNICIPIO')
  const location = departamento && municipio ? resolveLocation(departamento, municipio) : null
  if (departamento && municipio && !location) errors.push('EINVOICE_ISSUER_DEPARTAMENTO/MUNICIPIO no corresponden a un código DANE')

  const rangeFrom = Number(req('EINVOICE_RANGE_FROM'))
  const rangeTo = Number(req('EINVOICE_RANGE_TO'))
  if (rangeFrom && rangeTo && rangeFrom > rangeTo) errors.push('EINVOICE_RANGE_FROM > EINVOICE_RANGE_TO')

  const shippingTaxRate = Number(env('EINVOICE_SHIPPING_TAX_RATE', '0'))
  if (!Number.isFinite(shippingTaxRate) || shippingTaxRate < 0 || shippingTaxRate > 30) errors.push('EINVOICE_SHIPPING_TAX_RATE')

  let cert = null
  try {
    cert = loadCertificate()
    if (!cert) errors.push('EINVOICE_CERT_PEM_BASE64 / EINVOICE_KEY_PEM_BASE64')
  } catch (err) {
    errors.push(`certificado inválido: ${err.message}`)
  }

  const personType = env('EINVOICE_ISSUER_PERSON_TYPE', '1')
  if (!['1', '2'].includes(personType)) errors.push('EINVOICE_ISSUER_PERSON_TYPE (1 = jurídica, 2 = natural)')

  const config = {
    environment,
    issuer: {
      nit,
      dv,
      personType,
      name: req('EINVOICE_ISSUER_NAME'),
      tradeName: env('EINVOICE_ISSUER_TRADE_NAME') || env('EINVOICE_ISSUER_NAME'),
      // Responsabilidades fiscales (tabla 13.2.6.1), separadas por ';'. Ej: O-47 o R-99-PN.
      taxLevelCode: env('EINVOICE_ISSUER_TAX_LEVEL_CODE', 'R-99-PN'),
      // Tributo (tabla 13.2.6.2): 01 = IVA, ZZ = No aplica.
      taxSchemeId: env('EINVOICE_ISSUER_TAX_SCHEME', '01'),
      address: req('EINVOICE_ISSUER_ADDRESS'),
      postalZone: env('EINVOICE_ISSUER_POSTAL_ZONE'),
      location,
      email: req('EINVOICE_ISSUER_EMAIL'),
      phone: env('EINVOICE_ISSUER_PHONE'),
      commercialRegistration: env('EINVOICE_ISSUER_MATRICULA'),
    },
    resolution: {
      number: req('EINVOICE_RESOLUTION_NUMBER'),
      startDate: req('EINVOICE_RESOLUTION_START'),
      endDate: req('EINVOICE_RESOLUTION_END'),
      prefix: req('EINVOICE_PREFIX'),
      from: rangeFrom,
      to: rangeTo,
      technicalKey: req('EINVOICE_TECHNICAL_KEY'),
    },
    creditNotePrefix: env('EINVOICE_CREDIT_NOTE_PREFIX', 'NC'),
    software: {
      id: req('EINVOICE_SOFTWARE_ID'),
      pin: req('EINVOICE_SOFTWARE_PIN'),
      testSetId: env('EINVOICE_TEST_SET_ID'),
      // Código del proveedor tecnológico para el nombre de archivo: 000 = software propio.
      providerCode: env('EINVOICE_PROVIDER_CODE', '000'),
    },
    shippingTaxRate,
    paymentMeansCode: env('EINVOICE_PAYMENT_MEANS_CODE', 'ZZZ'),
    cert,
  }

  if (environment === '2' && !config.software.testSetId) {
    // En habilitación se envía con SendTestSetAsync, que exige el TestSetId.
    errors.push('EINVOICE_TEST_SET_ID (obligatorio en habilitación)')
  }

  if (errors.length) {
    const err = new Error(`Configuración de facturación electrónica incompleta: ${errors.join(', ')}`)
    err.code = 'EINVOICE_CONFIG'
    err.missing = errors
    throw err
  }
  return config
}

/** Resumen sin secretos para diagnósticos y logs. */
export const describeConfig = () => {
  try {
    const c = getConfig()
    return {
      ok: true,
      enabled: isEnabled(),
      environment: c.environment,
      issuer: `${c.issuer.nit}-${c.issuer.dv} ${c.issuer.name}`,
      prefix: c.resolution.prefix,
      range: `${c.resolution.from}-${c.resolution.to}`,
      resolutionValidUntil: c.resolution.endDate,
      certificateSubject: c.cert.certificate.subject.replace(/\n/g, ', '),
      certificateValidTo: c.cert.certificate.validTo,
    }
  } catch (err) {
    return { ok: false, enabled: isEnabled(), missing: err.missing ?? [err.message] }
  }
}
