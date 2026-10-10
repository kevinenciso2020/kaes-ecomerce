// Firma XAdES-EPES de documentos UBL según la política de firma DIAN v2.
//
// Estructura (igual a los ejemplos de la caja de herramientas DIAN):
//   ds:Signature
//     ds:SignedInfo (C14N 1.0, RSA-SHA256)
//       Reference URI=""                  → documento, transformación enveloped-signature
//       Reference URI="#…-keyinfo"        → ds:KeyInfo
//       Reference Type=SignedProperties   → xades:SignedProperties
//     ds:SignatureValue
//     ds:KeyInfo (X509Certificate)
//     ds:Object/xades:QualifyingProperties/xades:SignedProperties
//       SigningTime, SigningCertificate, SignaturePolicyIdentifier, SignerRole=supplier
//
// La firma va en la segunda ext:UBLExtension (la que queda vacía en el XML sin firmar).
import { createHash, createSign, randomUUID } from 'node:crypto'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { C14nCanonicalization } from 'xml-crypto'

const DS = 'http://www.w3.org/2000/09/xmldsig#'
const XADES = 'http://uri.etsi.org/01903/v1.3.2#'
const EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'

export const POLICY = {
  url: 'https://facturaelectronica.dian.gov.co/politicadefirma/v2/politicadefirmav2.pdf',
  // SHA-256 del PDF de la política (verificado contra el archivo publicado por la DIAN).
  digest: 'dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=',
}

const sha256b64 = (data) => createHash('sha256').update(data).digest('base64')

/** Namespaces declarados en los ancestros (para C14N inclusiva de un subárbol). */
const ancestorNamespaces = (node) => {
  const seen = new Map()
  for (let el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i]
      let prefix = null
      if (a.name === 'xmlns') prefix = ''
      else if (a.prefix === 'xmlns') prefix = a.localName
      if (prefix !== null && !seen.has(prefix)) seen.set(prefix, a.value)
    }
  }
  return [...seen.entries()]
    .filter(([, uri]) => uri !== '')
    .map(([prefix, namespaceURI]) => ({ prefix, namespaceURI }))
}

const canonicalize = (node) =>
  new C14nCanonicalization().process(node, { ancestorNamespaces: ancestorNamespaces(node) }).toString()

/** Documento sin la firma (transformación enveloped-signature) y canonicalizado. */
const canonicalDocumentWithoutSignature = (xml, signatureId) => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const sigs = doc.getElementsByTagNameNS(DS, 'Signature')
  for (let i = sigs.length - 1; i >= 0; i--) {
    if (sigs[i].getAttribute('Id') === signatureId) sigs[i].parentNode.removeChild(sigs[i])
  }
  return new C14nCanonicalization().process(doc.documentElement, { ancestorNamespaces: [] }).toString()
}

const pemBody = (certificate) => certificate.raw.toString('base64')

// RFC 4514 en orden inverso (CN primero) como hacen los validadores Java/.NET.
const issuerName = (certificate) =>
  certificate.issuer
    .split('\n')
    .filter(Boolean)
    .reverse()
    .join(',')

const serialDecimal = (certificate) => BigInt(`0x${certificate.serialNumber}`).toString(10)

/** Hora de Colombia (UTC-5, sin horario de verano) en formato xsd:dateTime. */
export const colombiaDateTime = (date = new Date()) => {
  const local = new Date(date.getTime() - 5 * 3600 * 1000)
  const iso = local.toISOString() // 2026-10-10T12:34:56.789Z
  return {
    date: iso.slice(0, 10),
    time: `${iso.slice(11, 19)}-05:00`,
    dateTime: `${iso.slice(0, 23)}-05:00`,
  }
}

/**
 * Firma un XML UBL. `cert` = { certificate: X509Certificate, chain: X509Certificate[], privateKey: KeyObject }.
 * Devuelve el XML firmado (string).
 */
export const signUblXml = (xml, cert, { now = new Date() } = {}) => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const contents = doc.getElementsByTagNameNS(EXT, 'ExtensionContent')
  const target = contents[contents.length - 1]
  if (!target || target.getElementsByTagNameNS('*', '*').length > 0) {
    throw new Error('El XML no tiene una ext:ExtensionContent vacía para la firma')
  }

  const id = `xmldsig-${randomUUID()}`
  const keyInfoId = `${id}-keyinfo`
  const signedPropsId = `${id}-signedprops`
  const chain = cert.chain?.length ? cert.chain : [cert.certificate]

  const certs = chain
    .map(
      (c) =>
        '<xades:Cert>' +
        `<xades:CertDigest><ds:DigestMethod Algorithm="${SHA256}"/><ds:DigestValue>${sha256b64(c.raw)}</ds:DigestValue></xades:CertDigest>` +
        `<xades:IssuerSerial><ds:X509IssuerName>${escapeText(issuerName(c))}</ds:X509IssuerName><ds:X509SerialNumber>${serialDecimal(c)}</ds:X509SerialNumber></xades:IssuerSerial>` +
        '</xades:Cert>',
    )
    .join('')

  // Los prefijos ds/xades ya están declarados en la raíz del documento UBL.
  const signatureXml =
    `<ds:Signature Id="${id}">` +
    `<ds:KeyInfo Id="${keyInfoId}"><ds:X509Data><ds:X509Certificate>${pemBody(cert.certificate)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties Target="#${id}">` +
    `<xades:SignedProperties Id="${signedPropsId}"><xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${colombiaDateTime(now).dateTime}</xades:SigningTime>` +
    `<xades:SigningCertificate>${certs}</xades:SigningCertificate>` +
    '<xades:SignaturePolicyIdentifier><xades:SignaturePolicyId>' +
    `<xades:SigPolicyId><xades:Identifier>${POLICY.url}</xades:Identifier></xades:SigPolicyId>` +
    `<xades:SigPolicyHash><ds:DigestMethod Algorithm="${SHA256}"/><ds:DigestValue>${POLICY.digest}</ds:DigestValue></xades:SigPolicyHash>` +
    '</xades:SignaturePolicyId></xades:SignaturePolicyIdentifier>' +
    '<xades:SignerRole><xades:ClaimedRoles><xades:ClaimedRole>supplier</xades:ClaimedRole></xades:ClaimedRoles></xades:SignerRole>' +
    '</xades:SignedSignatureProperties></xades:SignedProperties>' +
    '</xades:QualifyingProperties></ds:Object>' +
    '</ds:Signature>'

  const fragment = new DOMParser().parseFromString(
    `<root xmlns:ds="${DS}" xmlns:xades="${XADES}">${signatureXml}</root>`,
    'text/xml',
  )
  const signatureNode = doc.importNode(fragment.documentElement.firstChild, true)
  target.appendChild(signatureNode)

  const keyInfoNode = findById(signatureNode, keyInfoId)
  const signedPropsNode = findById(signatureNode, signedPropsId)

  const serializedWithPlaceholder = new XMLSerializer().serializeToString(doc)
  const documentDigest = sha256b64(canonicalDocumentWithoutSignature(serializedWithPlaceholder, id))
  const keyInfoDigest = sha256b64(canonicalize(keyInfoNode))
  const signedPropsDigest = sha256b64(canonicalize(signedPropsNode))

  const signedInfoXml =
    `<ds:SignedInfo xmlns:ds="${DS}">` +
    `<ds:CanonicalizationMethod Algorithm="${C14N}"/>` +
    `<ds:SignatureMethod Algorithm="${RSA_SHA256}"/>` +
    `<ds:Reference Id="${id}-ref0" URI=""><ds:Transforms><ds:Transform Algorithm="${ENVELOPED}"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA256}"/><ds:DigestValue>${documentDigest}</ds:DigestValue></ds:Reference>` +
    `<ds:Reference URI="#${keyInfoId}"><ds:DigestMethod Algorithm="${SHA256}"/><ds:DigestValue>${keyInfoDigest}</ds:DigestValue></ds:Reference>` +
    `<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropsId}"><ds:DigestMethod Algorithm="${SHA256}"/><ds:DigestValue>${signedPropsDigest}</ds:DigestValue></ds:Reference>` +
    '</ds:SignedInfo>'
  const signedInfoNode = doc.importNode(new DOMParser().parseFromString(signedInfoXml, 'text/xml').documentElement, true)
  // El xmlns:ds redundante se elimina: el prefijo ya está declarado en la raíz.
  signedInfoNode.removeAttribute('xmlns:ds')
  signatureNode.insertBefore(signedInfoNode, signatureNode.firstChild)

  const signatureValue = createSign('RSA-SHA256').update(canonicalize(signedInfoNode)).sign(cert.privateKey, 'base64')
  const valueNode = doc.createElementNS(DS, 'ds:SignatureValue')
  valueNode.setAttribute('Id', `${id}-sigvalue`)
  valueNode.appendChild(doc.createTextNode(signatureValue))
  signatureNode.insertBefore(valueNode, keyInfoNode)

  return new XMLSerializer().serializeToString(doc)
}

const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const findById = (root, id) => {
  if (root.nodeType === 1 && root.getAttribute('Id') === id) return root
  for (let c = root.firstChild; c; c = c.nextSibling) {
    const found = c.nodeType === 1 ? findById(c, id) : null
    if (found) return found
  }
  return null
}
