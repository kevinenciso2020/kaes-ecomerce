// Utilidades de prueba para facturación electrónica: certificado autofirmado,
// variables de entorno de habilitación y validación contra los XSD de la DIAN.
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { X509Certificate, createPrivateKey } from 'node:crypto'
import { validateXML } from 'xmllint-wasm'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', 'fixtures')

export const testCertPem = readFileSync(join(fixtures, 'einvoice', 'test-cert.pem'), 'utf8')
export const testKeyPem = readFileSync(join(fixtures, 'einvoice', 'test-key.pem'), 'utf8')

export const testCert = () => {
  const certificate = new X509Certificate(testCertPem)
  return { certificate, chain: [certificate], privateKey: createPrivateKey(testKeyPem) }
}

/** Datos de habilitación públicos de la DIAN (resolución y clave técnica de pruebas). */
export const TEST_ENV = {
  EINVOICE_ENABLED: 'true',
  EINVOICE_ENV: '2',
  EINVOICE_ISSUER_NIT: '900373115',
  EINVOICE_ISSUER_NAME: 'KAES PRUEBAS S.A.S.',
  EINVOICE_ISSUER_TRADE_NAME: 'KAES',
  EINVOICE_ISSUER_PERSON_TYPE: '1',
  EINVOICE_ISSUER_TAX_LEVEL_CODE: 'R-99-PN',
  EINVOICE_ISSUER_TAX_SCHEME: '01',
  EINVOICE_ISSUER_ADDRESS: 'Calle 10 # 43-20',
  EINVOICE_ISSUER_DEPARTAMENTO: 'Antioquia',
  EINVOICE_ISSUER_MUNICIPIO: 'Medellín',
  EINVOICE_ISSUER_POSTAL_ZONE: '050021',
  EINVOICE_ISSUER_EMAIL: 'facturacion@example.com',
  EINVOICE_ISSUER_PHONE: '3001234567',
  EINVOICE_RESOLUTION_NUMBER: '18760000001',
  EINVOICE_RESOLUTION_START: '2019-01-19',
  EINVOICE_RESOLUTION_END: '2030-01-19',
  EINVOICE_PREFIX: 'SETP',
  EINVOICE_RANGE_FROM: '990000000',
  EINVOICE_RANGE_TO: '995000000',
  EINVOICE_TECHNICAL_KEY: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
  EINVOICE_SOFTWARE_ID: '56f2ae4e-9812-4fad-9255-08fcfcd5ccb0',
  EINVOICE_SOFTWARE_PIN: '12345',
  EINVOICE_TEST_SET_ID: '00000000-0000-0000-0000-000000000000',
  EINVOICE_CERT_PEM_BASE64: Buffer.from(testCertPem).toString('base64'),
  EINVOICE_KEY_PEM_BASE64: Buffer.from(testKeyPem).toString('base64'),
}

export const withEnv = (vars) => {
  const previous = {}
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

const xsdDir = join(fixtures, 'dian-xsd')
const preload = ['common', 'maindoc'].flatMap((dir) =>
  readdirSync(join(xsdDir, dir)).map((f) => ({ fileName: `${dir}/${f}`, contents: readFileSync(join(xsdDir, dir, f), 'utf8') })),
)

const MAIN_XSD = {
  Invoice: ['urn:oasis:names:specification:ubl:schema:xsd:Invoice-2', 'maindoc/UBL-Invoice-2.1.xsd'],
  CreditNote: ['urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2', 'maindoc/UBL-CreditNote-2.1.xsd'],
  DebitNote: ['urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2', 'maindoc/UBL-DebitNote-2.1.xsd'],
  AttachedDocument: ['urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2', 'maindoc/UBL-AttachedDocument-2.1.xsd'],
}

/**
 * Valida contra los XSD de la caja de herramientas DIAN v1.9. El esquema
 * envoltorio importa también DIAN_UBL_Structures.xsd para que el contenido
 * de sts:DianExtensions (procesado en modo lax) sí se valide.
 */
export const validateAgainstDianXsd = async (xml, rootName) => {
  const [ns, location] = MAIN_XSD[rootName]
  const wrapper =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:kaes:test:wrapper">' +
    `<xsd:import namespace="${ns}" schemaLocation="${location}"/>` +
    '<xsd:import namespace="dian:gov:co:facturaelectronica:Structures-2-1" schemaLocation="maindoc/DIAN_UBL_Structures.xsd"/>' +
    '</xsd:schema>'
  const result = await validateXML({
    xml: [{ fileName: 'documento.xml', contents: xml }],
    schema: [{ fileName: 'wrapper.xsd', contents: wrapper }],
    preload,
    maxMemoryPages: 16384,
  })
  // DIAN_UBL_Structures.xsd restringe @schemeID de ProviderID/AuthorizationProviderID
  // a tipos de documento, pero el Anexo 1.9 y los XML de ejemplo oficiales informan
  // ahí el DV del NIT (los ejemplos de la caja de herramientas fallan igual). Se ignora.
  const errors = result.errors.filter(
    (e) => !/(ProviderID|AuthorizationProviderID)', attribute 'schemeID': \[facet 'enumeration'\]/.test(e.message),
  )
  return { valid: errors.length === 0, errors }
}
