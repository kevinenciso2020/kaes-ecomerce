// Convierte el certificado de firma digital (.p12 / .pfx) al formato que usa el
// backend (PEM en base64) e imprime las variables para Railway.
//
//   EINVOICE_P12_PASSWORD='clave' npm run einvoice:cert -- ruta/certificado.p12
//
// Requiere openssl instalado. La llave privada NUNCA se escribe en disco: se
// imprime en base64 para pegarla como variable secreta en Railway.
import { execFileSync } from 'node:child_process'
import { X509Certificate, createPrivateKey } from 'node:crypto'

const file = process.argv[2]
const password = process.env.EINVOICE_P12_PASSWORD
if (!file || password == null) {
  console.error('Uso: EINVOICE_P12_PASSWORD=\'clave\' npm run einvoice:cert -- ruta/certificado.p12')
  process.exit(1)
}

const run = (args) => {
  const base = ['pkcs12', '-in', file, '-passin', 'env:EINVOICE_P12_PASSWORD', ...args]
  try {
    return execFileSync('openssl', base, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  } catch {
    // Los .p12 de las entidades certificadoras suelen usar algoritmos antiguos (RC2-40).
    return execFileSync('openssl', [...base, '-legacy'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  }
}

const certs = run(['-nokeys']).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
const key = run(['-nocerts', '-nodes']).match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/)?.[0]
if (!certs.length || !key) {
  console.error('No se encontró certificado o llave privada en el archivo.')
  process.exit(1)
}

// El certificado del firmante va primero; luego la cadena (intermedios).
const parsed = certs.map((pem) => ({ pem, x509: new X509Certificate(pem) }))
const keyObject = createPrivateKey(key)
const signer = parsed.find((c) => c.x509.checkPrivateKey(keyObject)) ?? parsed[0]
const ordered = [signer, ...parsed.filter((c) => c !== signer)]

console.log('Certificado del firmante:')
console.log('  Sujeto :', signer.x509.subject.replace(/\n/g, ', '))
console.log('  Emisor :', signer.x509.issuer.replace(/\n/g, ', '))
console.log('  Vence  :', signer.x509.validTo)
console.log('')
console.log('Copia estas variables en Railway (servicio backend → Variables). Son secretas:')
console.log('')
console.log(`EINVOICE_CERT_PEM_BASE64=${Buffer.from(ordered.map((c) => c.pem).join('\n')).toString('base64')}`)
console.log('')
console.log(`EINVOICE_KEY_PEM_BASE64=${Buffer.from(key).toString('base64')}`)
