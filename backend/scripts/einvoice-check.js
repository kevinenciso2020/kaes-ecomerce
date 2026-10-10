// Diagnóstico de la configuración de facturación electrónica.
//
//   npm run einvoice:check              → valida variables y certificado
//   npm run einvoice:check -- --remote  → además consulta a la DIAN los rangos
//                                         de numeración del software (GetNumberingRange)
import 'dotenv/config'
import { getConfig, describeConfig, isEnabled } from '../src/services/einvoice/config.js'
import { createDianClient } from '../src/services/einvoice/dian-client.js'

const remote = process.argv.includes('--remote')

const main = async () => {
  const summary = describeConfig()
  console.log('Facturación electrónica:', isEnabled() ? 'ENCENDIDA' : 'apagada (EINVOICE_ENABLED != true)')
  if (!summary.ok) {
    console.log('\n❌ Configuración incompleta. Falta o es inválido:')
    for (const m of summary.missing) console.log('   -', m)
    process.exit(1)
  }
  console.log(summary)

  const config = getConfig()
  const cert = config.cert.certificate
  const warnings = []
  const now = Date.now()
  if (new Date(cert.validTo).getTime() < now) warnings.push(`El certificado venció el ${cert.validTo}`)
  else if (new Date(cert.validTo).getTime() - now < 30 * 86400_000) warnings.push(`El certificado vence pronto: ${cert.validTo}`)
  if (!cert.subject.includes(config.issuer.nit)) warnings.push(`El sujeto del certificado no menciona el NIT ${config.issuer.nit} (verifica que sea el certificado de la empresa)`)
  if (!cert.checkPrivateKey(config.cert.privateKey)) warnings.push('La llave privada NO corresponde al certificado')
  if (new Date(config.resolution.endDate).getTime() < now) warnings.push(`La resolución de numeración venció el ${config.resolution.endDate}`)
  if (config.environment === '1' && config.resolution.prefix === 'SETP') warnings.push('Estás en producción con el prefijo de pruebas SETP')

  console.log(warnings.length ? `\n⚠️  Advertencias:\n${warnings.map((w) => `   - ${w}`).join('\n')}` : '\n✅ Certificado y resolución en orden.')

  if (remote) {
    console.log(`\nConsultando rangos de numeración en la DIAN (${config.environment === '1' ? 'producción' : 'habilitación'})…`)
    const client = createDianClient({ environment: config.environment, cert: config.cert })
    const r = await client.getNumberingRange(config.issuer.nit, config.issuer.nit, config.software.id)
    console.log(`Respuesta: ${r.operationCode} ${r.operationDescription ?? ''}`)
    for (const range of r.ranges) {
      const match = range.prefix === config.resolution.prefix && String(range.resolutionNumber) === String(config.resolution.number)
      console.log(`  ${match ? '✅' : '  '} ${range.prefix} ${range.from}-${range.to} resolución ${range.resolutionNumber} vigente ${range.validDateFrom} → ${range.validDateTo}`)
      if (match && range.technicalKey && range.technicalKey !== config.resolution.technicalKey) {
        console.log('     ⚠️  La clave técnica de la DIAN es distinta a EINVOICE_TECHNICAL_KEY:', range.technicalKey)
      }
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
