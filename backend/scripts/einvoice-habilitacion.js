// Envía el set de pruebas de habilitación a la DIAN (software propio).
//
//   npm run einvoice:habilitacion -- --facturas 8 --creditos 1 --debitos 1
//
// Usa EINVOICE_ENV=2 (habilitación) y EINVOICE_TEST_SET_ID. Pon las cantidades que
// muestra el portal de habilitación en el detalle de tu set de pruebas. Los
// documentos usan datos ficticios y se numeran dentro del rango de pruebas
// (prefijo SETP). Opcional: --desde <número> para fijar el primer consecutivo.
import 'dotenv/config'
import { getConfig } from '../src/services/einvoice/config.js'
import { computeInvoiceAmounts, formatMoney } from '../src/services/einvoice/amounts.js'
import { computeCufe, computeCude, softwareSecurityCode, qrUrl } from '../src/services/einvoice/cufe.js'
import { buildInvoiceXml, buildCreditNoteXml, buildDebitNoteXml, normalizeBuyer } from '../src/services/einvoice/ubl-builder.js'
import { signUblXml, colombiaDateTime } from '../src/services/einvoice/signer.js'
import { createDianClient, dianFileName, zipBase64 } from '../src/services/einvoice/dian-client.js'
import { resolveLocation } from '../src/services/einvoice/divipola.js'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : def
}
const counts = { facturas: arg('facturas', 8), creditos: arg('creditos', 1), debitos: arg('debitos', 1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BUYERS = [
  {},
  { docType: '13', docNumber: '1020304050', name: 'Cliente Prueba Natural' },
  { docType: '31', docNumber: '800197268', dv: '4', name: 'DIAN PRUEBAS', personType: '1' },
]
const location = resolveLocation('Bogotá', 'Bogotá')

const sampleItems = (i) => [
  { description: `Camiseta de prueba ${i}`, code: `CAM-${i}`, quantity: 1 + (i % 3), unitPrice: 59900, taxRate: 19 },
  ...(i % 2 ? [{ description: 'Producto exento de prueba', code: 'EXE-1', quantity: 1, unitPrice: 30000, taxRate: 0 }] : []),
]

const main = async () => {
  const config = getConfig()
  if (config.environment !== '2') throw new Error('El set de pruebas solo se envía con EINVOICE_ENV=2 (habilitación)')
  const client = createDianClient({ environment: '2', cert: config.cert })
  const { from, to, prefix } = config.resolution
  let number = arg('desde', from + (Math.floor(Date.now() / 1000) % Math.max(1, to - from - 1000)))
  let fileSeq = Math.floor(Date.now() / 1000) % 0xffffff
  let ncNumber = 1 + (Math.floor(Date.now() / 1000) % 900000)
  let ndNumber = ncNumber

  console.log(`Set de pruebas ${config.software.testSetId}: ${counts.facturas} facturas, ${counts.creditos} notas crédito, ${counts.debitos} notas débito`)

  const send = async (label, fullNumber, signed, kind) => {
    const year = new Date().getFullYear()
    const seq = ++fileSeq
    const fileName = dianFileName({ kind, nit: config.issuer.nit, providerCode: config.software.providerCode, year, sequence: seq })
    const zipName = dianFileName({ kind: 'z', nit: config.issuer.nit, providerCode: config.software.providerCode, year, sequence: seq, ext: 'zip' })
    const { zipKey, errors } = await client.sendTestSetAsync(zipName, zipBase64(fileName, signed), config.software.testSetId)
    if (!zipKey) {
      console.log(`❌ ${label} ${fullNumber}: envío rechazado`, errors)
      return false
    }
    for (let i = 0; i < 30; i++) {
      await sleep(3000)
      const [r] = await client.getStatusZip(zipKey)
      if (r.isValid) {
        console.log(`✅ ${label} ${fullNumber} — ${r.statusDescription}`)
        return true
      }
      if (r.statusCode && !/proceso de validaci/i.test(r.statusDescription ?? '')) {
        console.log(`❌ ${label} ${fullNumber} rechazado: ${r.statusDescription}`)
        for (const e of r.errors) console.log('     ', e)
        return false
      }
    }
    console.log(`⏳ ${label} ${fullNumber}: la DIAN no respondió a tiempo (zipKey ${zipKey}); revisa el portal.`)
    return false
  }

  const invoices = []
  for (let i = 0; i < counts.facturas; i++) {
    const buyer = normalizeBuyer({ ...BUYERS[i % BUYERS.length], email: config.issuer.email, location, addressLine: 'Carrera 7 # 6C-54' })
    const amounts = computeInvoiceAmounts({ items: sampleItems(i), shipping: i % 2 ? 12000 : 0, shippingTaxRate: config.shippingTaxRate })
    const fullNumber = `${prefix}${number++}`
    const { date: issueDate, time: issueTime } = colombiaDateTime()
    const cufe = computeCufe({
      number: fullNumber, issueDate, issueTime, lineExtension: formatMoney(amounts.totals.lineExtension),
      taxIva: formatMoney(amounts.totals.taxTotal), payable: formatMoney(amounts.totals.payable),
      supplierNit: config.issuer.nit, customerId: buyer.docNumber, technicalKey: config.resolution.technicalKey, environment: '2',
    })
    const doc = { fullNumber, issueDate, issueTime, cufe, note: 'Documento de prueba de habilitación', securityCode: softwareSecurityCode(config.software.id, config.software.pin, fullNumber), qr: qrUrl('2', cufe) }
    const signed = signUblXml(buildInvoiceXml({ config, doc, buyer, amounts }), config.cert)
    if (await send('Factura', fullNumber, signed, 'fv')) invoices.push({ doc, buyer, amounts })
  }

  const note = async (kind, i) => {
    const ref = invoices[i % invoices.length]
    if (!ref) return console.log(`No hay facturas aceptadas para referenciar la nota ${kind}.`)
    const isCredit = kind === 'credito'
    const fullNumber = isCredit ? `NC${ncNumber++}` : `ND${ndNumber++}`
    const amounts = isCredit
      ? ref.amounts
      : computeInvoiceAmounts({ items: [{ description: 'Ajuste de prueba', code: 'AJU-1', quantity: 1, unitPrice: 11900, taxRate: 19 }] })
    const { date: issueDate, time: issueTime } = colombiaDateTime()
    const cude = computeCude({
      number: fullNumber, issueDate, issueTime, lineExtension: formatMoney(amounts.totals.lineExtension),
      taxIva: formatMoney(amounts.totals.taxTotal), payable: formatMoney(amounts.totals.payable),
      supplierNit: config.issuer.nit, customerId: ref.buyer.docNumber, softwarePin: config.software.pin, environment: '2',
    })
    const doc = {
      fullNumber, issueDate, issueTime, cufe: cude, securityCode: softwareSecurityCode(config.software.id, config.software.pin, fullNumber), qr: qrUrl('2', cude),
      invoice: { fullNumber: ref.doc.fullNumber, cufe: ref.doc.cufe, issueDate: ref.doc.issueDate },
    }
    const build = isCredit ? buildCreditNoteXml : buildDebitNoteXml
    const signed = signUblXml(build({ config, doc, buyer: ref.buyer, amounts }), config.cert)
    await send(isCredit ? 'Nota crédito' : 'Nota débito', fullNumber, signed, isCredit ? 'nc' : 'nd')
  }
  for (let i = 0; i < counts.creditos; i++) await note('credito', i)
  for (let i = 0; i < counts.debitos; i++) await note('debito', i)

  console.log('\nRevisa el estado del set en https://catalogo-vpfe-hab.dian.gov.co (Facturando electrónicamente → Configurar modos de operación).')
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
