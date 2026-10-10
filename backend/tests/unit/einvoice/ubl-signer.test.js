import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { SignedXml } from 'xml-crypto'
import { getConfig } from '../../../src/services/einvoice/config.js'
import { computeInvoiceAmounts, formatMoney } from '../../../src/services/einvoice/amounts.js'
import { computeCufe, computeCude, softwareSecurityCode, qrUrl } from '../../../src/services/einvoice/cufe.js'
import { buildInvoiceXml, buildCreditNoteXml, buildDebitNoteXml, buildAttachedDocument, normalizeBuyer } from '../../../src/services/einvoice/ubl-builder.js'
import { signUblXml } from '../../../src/services/einvoice/signer.js'
import { resolveLocation } from '../../../src/services/einvoice/divipola.js'
import { TEST_ENV, withEnv, testCertPem, validateAgainstDianXsd } from '../../helpers/einvoice.js'

let restore
let config
beforeAll(() => {
  restore = withEnv(TEST_ENV)
  config = getConfig()
})
afterAll(() => restore())

const amounts = () =>
  computeInvoiceAmounts({
    items: [
      { description: 'Camiseta básica <negra> & blanca', code: 'CAM-001', quantity: 2, unitPrice: 59900, taxRate: 19 },
      { description: 'Gorra exenta', code: 'GOR-002', quantity: 1, unitPrice: 30000, taxRate: 0 },
    ],
    discount: 14980,
    shipping: 12000,
    shippingTaxRate: 0,
    total: 59900 * 2 + 30000 - 14980 + 12000,
  })

const buildDoc = (buyer) => {
  const a = amounts()
  const fullNumber = 'SETP990000001'
  const issueDate = '2026-10-10'
  const issueTime = '10:15:30-05:00'
  const nb = normalizeBuyer(buyer)
  const cufe = computeCufe({
    number: fullNumber, issueDate, issueTime,
    lineExtension: formatMoney(a.totals.lineExtension), taxIva: formatMoney(a.totals.taxTotal),
    payable: formatMoney(a.totals.payable), supplierNit: config.issuer.nit, customerId: nb.docNumber,
    technicalKey: config.resolution.technicalKey, environment: config.environment,
  })
  const doc = {
    fullNumber, issueDate, issueTime, cufe, orderId: 'ord_123', note: 'Pedido ord_123',
    securityCode: softwareSecurityCode(config.software.id, config.software.pin, fullNumber),
    qr: qrUrl(config.environment, cufe),
  }
  return { doc, buyer: nb, amounts: a }
}

const verify = (signedXml) => {
  const dom = new DOMParser().parseFromString(signedXml, 'text/xml')
  const signature = dom.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0]
  const sig = new SignedXml({ publicCert: testCertPem })
  sig.loadSignature(signature)
  const ok = sig.checkSignature(signedXml)
  return { ok, references: sig.getSignedReferences().length }
}

describe('factura UBL 2.1', () => {
  const buyer = {
    location: { ...resolveLocation('Antioquia', 'Envigado'), postalZone: null },
    addressLine: 'Cra 43A # 1-50 apto 301',
  }

  it('es válida contra los XSD de la DIAN (consumidor final)', async () => {
    const { doc, buyer: b, amounts: a } = buildDoc(buyer)
    const xml = buildInvoiceXml({ config, doc, buyer: b, amounts: a })
    const result = await validateAgainstDianXsd(signUblXml(xml, config.cert), 'Invoice')
    expect(result.errors).toEqual([])
    expect(xml).toContain('<cbc:ID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeName="13">222222222222</cbc:ID>')
    expect(xml).toContain('<cbc:TaxLevelCode listName="49">R-99-PN</cbc:TaxLevelCode>')
    expect(xml).toContain('<cbc:CustomizationID>10</cbc:CustomizationID>')
    expect(xml).toContain('Camiseta básica &lt;negra&gt; &amp; blanca')
  })

  it('informa NIT con DV para un adquiriente empresa', async () => {
    const { doc, buyer: b, amounts: a } = buildDoc({ ...buyer, docType: '31', docNumber: '800197268', dv: '4', name: 'EMPRESA S.A.S.' })
    const xml = buildInvoiceXml({ config, doc, buyer: b, amounts: a })
    expect(xml).toContain('schemeID="4" schemeName="31">800197268</cbc:ID>')
    expect(xml).toContain('<cbc:AdditionalAccountID>1</cbc:AdditionalAccountID><cac:Party><cac:PartyIdentification>')
    expect((await validateAgainstDianXsd(signUblXml(xml, config.cert), 'Invoice')).errors).toEqual([])
  })

  it('el UUID y el QR corresponden al CUFE calculado con los totales del XML', () => {
    const { doc, buyer: b, amounts: a } = buildDoc(buyer)
    const xml = buildInvoiceXml({ config, doc, buyer: b, amounts: a })
    const dom = new DOMParser().parseFromString(xml, 'text/xml')
    const text = (tag) => dom.getElementsByTagName(tag)[0].textContent
    const lme = dom.getElementsByTagName('cac:LegalMonetaryTotal')[0]
    const cufe = computeCufe({
      number: text('cbc:ID'), issueDate: text('cbc:IssueDate'), issueTime: text('cbc:IssueTime'),
      lineExtension: lme.getElementsByTagName('cbc:LineExtensionAmount')[0].textContent,
      taxIva: dom.getElementsByTagName('cac:TaxTotal')[0].getElementsByTagName('cbc:TaxAmount')[0].textContent,
      payable: lme.getElementsByTagName('cbc:PayableAmount')[0].textContent,
      supplierNit: config.issuer.nit, customerId: '222222222222',
      technicalKey: config.resolution.technicalKey, environment: '2',
    })
    expect(text('cbc:UUID')).toBe(cufe)
    expect(text('sts:QRCode')).toBe(`https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${cufe}`)
  })

  it('firma XAdES-EPES verificable y el XML firmado sigue siendo válido', async () => {
    const { doc, buyer: b, amounts: a } = buildDoc(buyer)
    const signed = signUblXml(buildInvoiceXml({ config, doc, buyer: b, amounts: a }), config.cert)
    expect(verify(signed)).toEqual({ ok: true, references: 3 })
    expect(signed).toContain('politicadefirmav2.pdf')
    expect(signed).toContain('<xades:ClaimedRole>supplier</xades:ClaimedRole>')
    expect((await validateAgainstDianXsd(signed, 'Invoice')).errors).toEqual([])
  })

  it('la firma deja de ser válida si se altera el documento', () => {
    const { doc, buyer: b, amounts: a } = buildDoc(buyer)
    const signed = signUblXml(buildInvoiceXml({ config, doc, buyer: b, amounts: a }), config.cert)
    const tampered = signed.replace('<cbc:InvoiceTypeCode>01<', '<cbc:InvoiceTypeCode>02<')
    expect(verify(tampered).ok).toBe(false)
  })
})

describe('nota crédito UBL 2.1', () => {
  it('referencia la factura, usa CUDE y es válida y verificable', async () => {
    const { buyer: b, amounts: a } = buildDoc({})
    const fullNumber = 'NC1'
    const cude = computeCude({
      number: fullNumber, issueDate: '2026-10-11', issueTime: '09:00:00-05:00',
      lineExtension: formatMoney(a.totals.lineExtension), taxIva: formatMoney(a.totals.taxTotal),
      payable: formatMoney(a.totals.payable), supplierNit: config.issuer.nit, customerId: b.docNumber,
      softwarePin: config.software.pin, environment: config.environment,
    })
    const xml = buildCreditNoteXml({
      config,
      buyer: b,
      amounts: a,
      doc: {
        fullNumber, issueDate: '2026-10-11', issueTime: '09:00:00-05:00', cufe: cude, orderId: 'ord_123',
        securityCode: softwareSecurityCode(config.software.id, config.software.pin, fullNumber),
        qr: qrUrl('2', cude), reason: 'Pedido cancelado',
        invoice: { fullNumber: 'SETP990000001', cufe: 'a'.repeat(96), issueDate: '2026-10-10' },
      },
    })
    expect(xml).toContain('<cbc:ResponseCode>2</cbc:ResponseCode>')
    expect(xml).not.toContain('sts:InvoiceControl')
    const signed = signUblXml(xml, config.cert)
    expect(verify(signed).ok).toBe(true)
    expect((await validateAgainstDianXsd(signed, 'CreditNote')).errors).toEqual([])
  })
})

describe('nota débito UBL 2.1', () => {
  it('es válida contra el XSD y verificable', async () => {
    const { buyer: b, amounts: a } = buildDoc({})
    const xml = buildDebitNoteXml({
      config, buyer: b, amounts: a,
      doc: {
        fullNumber: 'ND1', issueDate: '2026-10-11', issueTime: '09:00:00-05:00', cufe: 'b'.repeat(96),
        securityCode: softwareSecurityCode(config.software.id, config.software.pin, 'ND1'), qr: qrUrl('2', 'b'),
        invoice: { fullNumber: 'SETP990000001', cufe: 'a'.repeat(96), issueDate: '2026-10-10' },
      },
    })
    expect(xml).toContain('<cbc:CustomizationID>30</cbc:CustomizationID>')
    expect(xml).toContain('<cac:RequestedMonetaryTotal>')
    const signed = signUblXml(xml, config.cert)
    expect(verify(signed).ok).toBe(true)
    expect((await validateAgainstDianXsd(signed, 'DebitNote')).errors).toEqual([])
  })
})

describe('AttachedDocument', () => {
  it('contiene la factura y la respuesta DIAN, y es válido firmado', async () => {
    const { doc, buyer: b, amounts: a } = buildDoc({})
    const signedInvoice = signUblXml(buildInvoiceXml({ config, doc, buyer: b, amounts: a }), config.cert)
    const attached = buildAttachedDocument({
      config, doc: { ...doc, type: 'INVOICE' }, buyer: b, signedXml: signedInvoice,
      applicationResponse: '<ApplicationResponse/>', validation: { date: '2026-10-10', time: '10:16:00-05:00' },
    })
    const signed = signUblXml(attached, config.cert)
    expect(verify(signed).ok).toBe(true)
    expect((await validateAgainstDianXsd(signed, 'AttachedDocument')).errors).toEqual([])
  })
})
