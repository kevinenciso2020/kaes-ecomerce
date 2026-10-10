// Cliente SOAP 1.2 del web service de la DIAN (WcfDianCustomerServices) con
// WS-Security: BinarySecurityToken X.509 + firma RSA-SHA256 del encabezado wsa:To.
import { createHash, createSign, randomUUID } from 'node:crypto'
import axios from 'axios'
import { DOMParser } from '@xmldom/xmldom'
import { ExclusiveCanonicalization } from 'xml-crypto'
import { zipSync, strToU8 } from 'fflate'

export const ENDPOINTS = {
  1: 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc',
  2: 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc',
}

const NS = {
  soap: 'http://www.w3.org/2003/05/soap-envelope',
  wcf: 'http://wcf.dian.colombia',
  wsa: 'http://www.w3.org/2005/08/addressing',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  ec: 'http://www.w3.org/2001/10/xml-exc-c14n#',
}
const X509V3 = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3'
const BASE64 = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary'
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Comprime un XML en un ZIP (un solo archivo) y lo devuelve en base64. */
export const zipBase64 = (fileName, xml) => Buffer.from(zipSync({ [fileName]: strToU8(xml) }, { level: 6 })).toString('base64')

const excC14n = (xml, localName, namespaceURI, prefixList) => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const node = doc.getElementsByTagNameNS(namespaceURI, localName)[0]
  const ancestorNamespaces = []
  for (let el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i]
      if (a.prefix === 'xmlns' && !ancestorNamespaces.some((n) => n.prefix === a.localName)) {
        ancestorNamespaces.push({ prefix: a.localName, namespaceURI: a.value })
      }
    }
  }
  return new ExclusiveCanonicalization()
    .process(node, { inclusiveNamespacesPrefixList: prefixList, ancestorNamespaces })
    .toString()
}

/** Construye y firma el sobre SOAP para una operación del servicio. */
export const buildSignedEnvelope = ({ action, bodyXml, endpoint, cert, now = new Date(), ttlSeconds = 60000 }) => {
  const created = now.toISOString().replace(/\.\d+Z$/, 'Z')
  const expires = new Date(now.getTime() + ttlSeconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z')
  const u = randomUUID()
  const ids = { ts: `TS-${u}`, bst: `X509-${u}`, sig: `SIG-${u}`, ki: `KI-${u}`, str: `STR-${u}`, to: `id-${u}` }
  const token = cert.certificate.raw.toString('base64')

  const signedInfo = (digest) =>
    `<ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="${EXC_C14N}"><ec:InclusiveNamespaces PrefixList="wsa soap wcf" xmlns:ec="${NS.ec}"/></ds:CanonicalizationMethod>` +
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
    `<ds:Reference URI="#${ids.to}"><ds:Transforms><ds:Transform Algorithm="${EXC_C14N}"><ec:InclusiveNamespaces PrefixList="soap wcf" xmlns:ec="${NS.ec}"/></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference>` +
    '</ds:SignedInfo>'

  const envelope = (digest, signatureValue) =>
    `<soap:Envelope xmlns:soap="${NS.soap}" xmlns:wcf="${NS.wcf}">` +
    `<soap:Header xmlns:wsa="${NS.wsa}">` +
    `<wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}">` +
    `<wsu:Timestamp wsu:Id="${ids.ts}"><wsu:Created>${created}</wsu:Created><wsu:Expires>${expires}</wsu:Expires></wsu:Timestamp>` +
    `<wsse:BinarySecurityToken EncodingType="${BASE64}" ValueType="${X509V3}" wsu:Id="${ids.bst}">${token}</wsse:BinarySecurityToken>` +
    `<ds:Signature Id="${ids.sig}" xmlns:ds="${NS.ds}">` +
    signedInfo(digest) +
    `<ds:SignatureValue>${signatureValue}</ds:SignatureValue>` +
    `<ds:KeyInfo Id="${ids.ki}"><wsse:SecurityTokenReference wsu:Id="${ids.str}"><wsse:Reference URI="#${ids.bst}" ValueType="${X509V3}"/></wsse:SecurityTokenReference></ds:KeyInfo>` +
    '</ds:Signature>' +
    '</wsse:Security>' +
    `<wsa:Action>${esc(action)}</wsa:Action>` +
    `<wsa:To wsu:Id="${ids.to}" xmlns:wsu="${NS.wsu}">${esc(endpoint)}</wsa:To>` +
    '</soap:Header>' +
    `<soap:Body>${bodyXml}</soap:Body>` +
    '</soap:Envelope>'

  const draft = envelope('', '')
  const digest = createHash('sha256').update(excC14n(draft, 'To', NS.wsa, ['soap', 'wcf'])).digest('base64')
  const withDigest = envelope(digest, '')
  const canonicalSignedInfo = excC14n(withDigest, 'SignedInfo', NS.ds, ['wsa', 'soap', 'wcf'])
  const signatureValue = createSign('RSA-SHA256').update(canonicalSignedInfo).sign(cert.privateKey, 'base64')
  return envelope(digest, signatureValue)
}

// ── Lectura de respuestas ────────────────────────────────────────────────────

const byLocalName = (root, name) => {
  const out = []
  const walk = (n) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) {
        if (c.localName === name) out.push(c)
        walk(c)
      }
    }
  }
  walk(root)
  return out
}
const textOf = (root, name) => {
  const el = byLocalName(root, name)[0]
  if (!el || el.getAttribute('i:nil') === 'true') return null
  return el.textContent
}

export class DianSoapError extends Error {
  constructor(message, { status, body, retryable } = {}) {
    super(message)
    this.name = 'DianSoapError'
    this.status = status
    this.body = body
    // Red caída o HTTP 5xx se reintentan; un Fault atribuido al cliente
    // (certificado no autorizado, sobre inválido) no.
    this.retryable = retryable ?? (status == null || status >= 500)
  }
}

const parseResponse = (xml) => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const fault = byLocalName(doc, 'Fault')[0]
  if (fault) {
    const reason = textOf(fault, 'Text') ?? textOf(fault, 'faultstring') ?? 'SOAP Fault'
    // SOAP 1.2: Code/Value = s:Sender (error del cliente) o s:Receiver (falla del servidor).
    const code = textOf(fault, 'Value') ?? textOf(fault, 'faultcode') ?? ''
    const clientFault = /Sender|Client/i.test(code)
    throw new DianSoapError(`DIAN: ${reason}`, { status: 500, body: xml, retryable: !clientFault })
  }
  return doc
}

/** Interpreta un DianResponse (SendBillSync / GetStatus / GetStatusZip). */
export const parseDianResponse = (root) => {
  const errors = byLocalName(root, 'ErrorMessage').flatMap((em) => byLocalName(em, 'string').map((s) => s.textContent))
  const xmlBase64 = textOf(root, 'XmlBase64Bytes')
  return {
    isValid: textOf(root, 'IsValid') === 'true',
    statusCode: textOf(root, 'StatusCode'),
    statusDescription: textOf(root, 'StatusDescription'),
    statusMessage: textOf(root, 'StatusMessage'),
    documentKey: textOf(root, 'XmlDocumentKey'),
    fileName: textOf(root, 'XmlFileName'),
    errors,
    applicationResponse: xmlBase64 ? Buffer.from(xmlBase64, 'base64').toString('utf8') : null,
  }
}

/**
 * @param {object} p
 * @param {'1'|'2'} p.environment
 * @param {object}  p.cert  { certificate, privateKey }
 * @param {object} [p.http] cliente compatible con axios.post (inyectable en pruebas)
 */
export const createDianClient = ({ environment, cert, http = axios, timeoutMs = 60000 }) => {
  if (!ENDPOINTS[environment]) throw new Error(`Ambiente DIAN inválido: ${environment}`)
  // Solo para pruebas locales contra un servidor simulado; se ignora en producción.
  const override = process.env.NODE_ENV !== 'production' ? process.env.EINVOICE_DIAN_ENDPOINT_OVERRIDE : null
  const endpoint = override || ENDPOINTS[environment]

  const call = async (operation, bodyXml) => {
    const action = `http://wcf.dian.colombia/IWcfDianCustomerServices/${operation}`
    const envelope = buildSignedEnvelope({ action, bodyXml, endpoint, cert })
    let res
    try {
      res = await http.post(endpoint, envelope, {
        headers: { 'Content-Type': `application/soap+xml;charset=UTF-8;action="${action}"` },
        timeout: timeoutMs,
        responseType: 'text',
        transformResponse: (d) => d,
        validateStatus: () => true,
      })
    } catch (err) {
      throw new DianSoapError(`No se pudo conectar con la DIAN: ${err.message}`)
    }
    const body = typeof res.data === 'string' ? res.data : String(res.data ?? '')
    if (res.status >= 400 && !body.includes('Fault')) {
      throw new DianSoapError(`DIAN respondió HTTP ${res.status}`, { status: res.status, body })
    }
    return parseResponse(body)
  }

  return {
    endpoint,

    /** Producción: envío síncrono. Devuelve la validación de la DIAN. */
    async sendBillSync(zipFileName, zipB64) {
      const doc = await call('SendBillSync', `<wcf:SendBillSync><wcf:fileName>${esc(zipFileName)}</wcf:fileName><wcf:contentFile>${zipB64}</wcf:contentFile></wcf:SendBillSync>`)
      return parseDianResponse(byLocalName(doc, 'SendBillSyncResult')[0] ?? doc)
    },

    /** Habilitación: envío asíncrono del set de pruebas. Devuelve el ZipKey (trackId). */
    async sendTestSetAsync(zipFileName, zipB64, testSetId) {
      const doc = await call(
        'SendTestSetAsync',
        `<wcf:SendTestSetAsync><wcf:fileName>${esc(zipFileName)}</wcf:fileName><wcf:contentFile>${zipB64}</wcf:contentFile><wcf:testSetId>${esc(testSetId)}</wcf:testSetId></wcf:SendTestSetAsync>`,
      )
      const zipKey = textOf(doc, 'ZipKey')
      const errors = byLocalName(doc, 'ErrorMessageList').flatMap((l) => byLocalName(l, 'ProcessedMessage').map((m) => m.textContent))
      return { zipKey, errors }
    },

    /** Estado de un envío asíncrono (habilitación). */
    async getStatusZip(trackId) {
      const doc = await call('GetStatusZip', `<wcf:GetStatusZip><wcf:trackId>${esc(trackId)}</wcf:trackId></wcf:GetStatusZip>`)
      const responses = byLocalName(doc, 'DianResponse')
      return (responses.length ? responses : [doc]).map(parseDianResponse)
    },

    /** Estado de un documento por su CUFE/CUDE. */
    async getStatus(trackId) {
      const doc = await call('GetStatus', `<wcf:GetStatus><wcf:trackId>${esc(trackId)}</wcf:trackId></wcf:GetStatus>`)
      return parseDianResponse(byLocalName(doc, 'GetStatusResult')[0] ?? doc)
    },

    /** Rangos de numeración autorizados para el software. */
    async getNumberingRange(accountCode, accountCodeT, softwareCode) {
      const doc = await call(
        'GetNumberingRange',
        `<wcf:GetNumberingRange><wcf:accountCode>${esc(accountCode)}</wcf:accountCode><wcf:accountCodeT>${esc(accountCodeT)}</wcf:accountCodeT><wcf:softwareCode>${esc(softwareCode)}</wcf:softwareCode></wcf:GetNumberingRange>`,
      )
      return {
        operationCode: textOf(doc, 'OperationCode'),
        operationDescription: textOf(doc, 'OperationDescription'),
        ranges: byLocalName(doc, 'NumberRangeResponse').map((r) => ({
          resolutionNumber: textOf(r, 'ResolutionNumber'),
          resolutionDate: textOf(r, 'ResolutionDate'),
          prefix: textOf(r, 'Prefix'),
          from: Number(textOf(r, 'FromNumber')),
          to: Number(textOf(r, 'ToNumber')),
          validDateFrom: textOf(r, 'ValidDateFrom'),
          validDateTo: textOf(r, 'ValidDateTo'),
          technicalKey: textOf(r, 'TechnicalKey'),
        })),
      }
    },
  }
}

/** Nombre de archivo según el numeral 13.x del Anexo: fv/nc/ad + NIT(10) + PPP + AA + consecutivo hex(8). */
export const dianFileName = ({ kind, nit, providerCode = '000', year, sequence, ext = 'xml' }) =>
  `${kind}${String(nit).padStart(10, '0')}${providerCode}${String(year).slice(-2)}${sequence.toString(16).padStart(8, '0')}.${ext}`
