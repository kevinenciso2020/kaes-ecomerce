import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getConfig } from '../../../src/services/einvoice/config.js'
import { computeInvoiceAmounts, formatMoney } from '../../../src/services/einvoice/amounts.js'
import { computeCufe, softwareSecurityCode, qrUrl } from '../../../src/services/einvoice/cufe.js'
import { buildInvoiceXml, normalizeBuyer } from '../../../src/services/einvoice/ubl-builder.js'
import { signUblXml } from '../../../src/services/einvoice/signer.js'
import { extractPdfData, renderPdf } from '../../../src/services/einvoice/pdf.js'
import { resolveLocation } from '../../../src/services/einvoice/divipola.js'
import { TEST_ENV, withEnv } from '../../helpers/einvoice.js'

let restore
beforeAll(() => { restore = withEnv(TEST_ENV) })
afterAll(() => restore())

export const sampleSignedInvoice = () => {
  const config = getConfig()
  const amounts = computeInvoiceAmounts({
    items: [
      { description: 'Camiseta oversize — talla M / negro', code: 'CAM-M-NEG', quantity: 2, unitPrice: 59900, taxRate: 19 },
      { description: 'Gorra', code: 'GOR-01', quantity: 1, unitPrice: 30000, taxRate: 0 },
    ],
    discount: 10000, shipping: 12000, total: 59900 * 2 + 30000 - 10000 + 12000,
  })
  const buyer = normalizeBuyer({
    docType: '13', docNumber: '1020304050', name: 'María Pérez',
    email: 'maria@example.com', location: resolveLocation('Antioquia', 'Envigado'), addressLine: 'Cra 43A # 1-50',
  })
  const fullNumber = 'SETP990000007'
  const issueDate = '2026-10-10'
  const issueTime = '10:15:30-05:00'
  const cufe = computeCufe({
    number: fullNumber, issueDate, issueTime, lineExtension: formatMoney(amounts.totals.lineExtension),
    taxIva: formatMoney(amounts.totals.taxTotal), payable: formatMoney(amounts.totals.payable),
    supplierNit: config.issuer.nit, customerId: buyer.docNumber, technicalKey: config.resolution.technicalKey, environment: '2',
  })
  const xml = buildInvoiceXml({
    config, buyer, amounts,
    doc: { fullNumber, issueDate, issueTime, cufe, orderId: 'ord_1', securityCode: softwareSecurityCode('a', 'b', fullNumber), qr: qrUrl('2', cufe) },
  })
  return signUblXml(xml, config.cert)
}

describe('representación gráfica', () => {
  it('extrae del XML firmado los datos del PDF', () => {
    const d = extractPdfData(sampleSignedInvoice())
    expect(d).toMatchObject({
      isCreditNote: false,
      number: 'SETP990000007',
      environment: '2',
      supplier: { nit: '900373115-3', name: 'KAES PRUEBAS S.A.S.', responsibleIva: true },
      customer: { name: 'María Pérez', docLabel: 'C.C.', doc: '1020304050' },
      totals: { payable: '151800.00' },
    })
    expect(d.lines).toHaveLength(3)
    expect(d.resolution.prefix).toBe('SETP')
  })

  it('genera un PDF válido', async () => {
    const pdf = await renderPdf(sampleSignedInvoice(), { validatedAt: new Date('2026-10-10T15:16:00Z') })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(3000)
    if (process.env.EINVOICE_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.EINVOICE_PDF_OUT, pdf)
  })
})
