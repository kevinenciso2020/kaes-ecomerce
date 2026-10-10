// Representación gráfica (PDF) de la factura / nota crédito electrónica.
// Se genera a partir del XML firmado para que siempre coincida con lo enviado a la DIAN.
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { DOMParser } from '@xmldom/xmldom'

const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'
const STS = 'dian:gov:co:facturaelectronica:Structures-2-1'

const child = (el, ns, name) => {
  for (let c = el?.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === name) return c
  }
  return null
}
const path = (el, ...steps) => steps.reduce((node, step) => {
  const [prefix, name] = step.split(':')
  return node && child(node, prefix === 'cbc' ? CBC : prefix === 'cac' ? CAC : STS, name)
}, el)
const text = (el, ...steps) => path(el, ...steps)?.textContent?.trim() ?? ''
const children = (el, ns, name) => {
  const out = []
  for (let c = el?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === name) out.push(c)
  return out
}

const cop = (v) =>
  `$ ${Number(v || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const PAYMENT_MEANS = { 10: 'Efectivo', 42: 'Consignación bancaria', 47: 'Transferencia débito bancaria', 48: 'Tarjeta crédito', 49: 'Tarjeta débito', ZZZ: 'Otro (pasarela de pago en línea)' }

const DOC_TYPES = { 13: 'C.C.', 22: 'C.E.', 31: 'NIT', 41: 'Pasaporte', 47: 'PEP', 48: 'PPT' }

/** Extrae del XML firmado los datos que se muestran en el PDF. */
export const extractPdfData = (signedXml) => {
  const doc = new DOMParser().parseFromString(signedXml, 'text/xml')
  const root = doc.documentElement
  const isCreditNote = root.localName === 'CreditNote'
  const dian = doc.getElementsByTagNameNS(STS, 'DianExtensions')[0]

  const supplier = path(root, 'cac:AccountingSupplierParty', 'cac:Party')
  const customer = path(root, 'cac:AccountingCustomerParty', 'cac:Party')
  const supplierTax = path(supplier, 'cac:PartyTaxScheme')
  const customerTax = path(customer, 'cac:PartyTaxScheme')
  const supplierAddr = path(supplier, 'cac:PhysicalLocation', 'cac:Address')
  const customerAddr = path(customer, 'cac:PhysicalLocation', 'cac:Address')
  const companyId = (taxScheme) => path(taxScheme, 'cbc:CompanyID')

  const lineTag = isCreditNote ? 'CreditNoteLine' : 'InvoiceLine'
  const qtyTag = isCreditNote ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity'
  const lines = children(root, CAC, lineTag).map((l) => ({
    description: text(l, 'cac:Item', 'cbc:Description'),
    code: text(l, 'cac:Item', 'cac:SellersItemIdentification', 'cbc:ID'),
    quantity: text(l, qtyTag),
    unitPrice: text(l, 'cac:Price', 'cbc:PriceAmount'),
    allowance: text(l, 'cac:AllowanceCharge', 'cbc:Amount') || '0',
    base: text(l, 'cbc:LineExtensionAmount'),
    rate: text(l, 'cac:TaxTotal', 'cac:TaxSubtotal', 'cac:TaxCategory', 'cbc:Percent'),
    tax: text(l, 'cac:TaxTotal', 'cbc:TaxAmount') || '0',
  }))

  const taxSubtotals = children(path(root, 'cac:TaxTotal'), CAC, 'TaxSubtotal').map((t) => ({
    rate: text(t, 'cac:TaxCategory', 'cbc:Percent'),
    taxable: text(t, 'cbc:TaxableAmount'),
    tax: text(t, 'cbc:TaxAmount'),
  }))

  const totals = path(root, 'cac:LegalMonetaryTotal')
  const custId = companyId(customerTax)

  return {
    isCreditNote,
    number: text(root, 'cbc:ID'),
    cufe: text(root, 'cbc:UUID'),
    issueDate: text(root, 'cbc:IssueDate'),
    issueTime: text(root, 'cbc:IssueTime'),
    environment: text(root, 'cbc:ProfileExecutionID'),
    qr: text(dian, 'sts:QRCode'),
    resolution: dian && path(dian, 'sts:InvoiceControl')
      ? {
          number: text(dian, 'sts:InvoiceControl', 'sts:InvoiceAuthorization'),
          start: text(dian, 'sts:InvoiceControl', 'sts:AuthorizationPeriod', 'cbc:StartDate'),
          end: text(dian, 'sts:InvoiceControl', 'sts:AuthorizationPeriod', 'cbc:EndDate'),
          prefix: text(dian, 'sts:InvoiceControl', 'sts:AuthorizedInvoices', 'sts:Prefix'),
          from: text(dian, 'sts:InvoiceControl', 'sts:AuthorizedInvoices', 'sts:From'),
          to: text(dian, 'sts:InvoiceControl', 'sts:AuthorizedInvoices', 'sts:To'),
        }
      : null,
    reference: isCreditNote
      ? {
          number: text(root, 'cac:BillingReference', 'cac:InvoiceDocumentReference', 'cbc:ID'),
          cufe: text(root, 'cac:BillingReference', 'cac:InvoiceDocumentReference', 'cbc:UUID'),
          reason: text(root, 'cac:DiscrepancyResponse', 'cbc:Description'),
        }
      : null,
    supplier: {
      name: text(supplierTax, 'cbc:RegistrationName'),
      tradeName: text(supplier, 'cac:PartyName', 'cbc:Name'),
      nit: `${companyId(supplierTax)?.textContent ?? ''}-${companyId(supplierTax)?.getAttribute('schemeID') ?? ''}`,
      taxLevel: text(supplierTax, 'cbc:TaxLevelCode'),
      responsibleIva: text(supplierTax, 'cac:TaxScheme', 'cbc:ID') === '01',
      address: [text(supplierAddr, 'cac:AddressLine', 'cbc:Line'), text(supplierAddr, 'cbc:CityName'), text(supplierAddr, 'cbc:CountrySubentity')].filter(Boolean).join(', '),
      email: text(supplier, 'cac:Contact', 'cbc:ElectronicMail'),
      phone: text(supplier, 'cac:Contact', 'cbc:Telephone'),
    },
    customer: {
      name: text(customerTax, 'cbc:RegistrationName'),
      docLabel: DOC_TYPES[custId?.getAttribute('schemeName')] ?? 'Doc.',
      doc: `${custId?.textContent ?? ''}${custId?.getAttribute('schemeID') ? `-${custId.getAttribute('schemeID')}` : ''}`,
      address: customerAddr
        ? [text(customerAddr, 'cac:AddressLine', 'cbc:Line'), text(customerAddr, 'cbc:CityName'), text(customerAddr, 'cbc:CountrySubentity')].filter(Boolean).join(', ')
        : '',
      email: text(customer, 'cac:Contact', 'cbc:ElectronicMail'),
    },
    paymentMeans: text(root, 'cac:PaymentMeans', 'cbc:PaymentMeansCode'),
    lines,
    taxSubtotals,
    totals: {
      lineExtension: text(totals, 'cbc:LineExtensionAmount'),
      taxInclusive: text(totals, 'cbc:TaxInclusiveAmount'),
      rounding: text(totals, 'cbc:PayableRoundingAmount') || '0',
      payable: text(totals, 'cbc:PayableAmount'),
      tax: text(path(root, 'cac:TaxTotal'), 'cbc:TaxAmount') || '0',
    },
  }
}

/**
 * @param {string} signedXml
 * @param {object} [opts] { validatedAt?: Date, softwareName?: string }
 * @returns {Promise<Buffer>}
 */
export const renderPdf = async (signedXml, { validatedAt, softwareName = 'Software propio' } = {}) => {
  const d = extractPdfData(signedXml)
  const qrPng = d.qr ? await QRCode.toBuffer(d.qr, { margin: 1, width: 220 }) : null

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'LETTER', margin: 36, info: { Title: `${d.isCreditNote ? 'Nota crédito' : 'Factura'} ${d.number}` } })
    const chunks = []
    pdf.on('data', (c) => chunks.push(c))
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)

    const left = 36
    const width = pdf.page.width - 72

    // Encabezado: emisor + título
    pdf.font('Helvetica-Bold').fontSize(14).text(d.supplier.tradeName || d.supplier.name, left, 36, { width: width - 180 })
    pdf.font('Helvetica').fontSize(8.5)
    if (d.supplier.tradeName && d.supplier.tradeName !== d.supplier.name) pdf.text(d.supplier.name, { width: width - 180 })
    pdf.text(`NIT ${d.supplier.nit}`, { width: width - 180 })
    pdf.text(d.supplier.responsibleIva ? 'Responsable de IVA' : 'No responsable de IVA', { width: width - 180 })
    if (d.supplier.taxLevel && d.supplier.taxLevel !== 'R-99-PN') pdf.text(`Responsabilidades: ${d.supplier.taxLevel}`, { width: width - 180 })
    pdf.text(d.supplier.address, { width: width - 180 })
    pdf.text([d.supplier.phone, d.supplier.email].filter(Boolean).join(' · '), { width: width - 180 })

    pdf.font('Helvetica-Bold').fontSize(11)
      .text(d.isCreditNote ? 'NOTA CRÉDITO ELECTRÓNICA' : 'FACTURA ELECTRÓNICA DE VENTA', left + width - 175, 36, { width: 175, align: 'right' })
    pdf.fontSize(13).text(`No. ${d.number}`, { width: 175, align: 'right' })
    pdf.font('Helvetica').fontSize(8.5)
      .text(`Fecha de emisión: ${d.issueDate} ${d.issueTime}`, { width: 175, align: 'right' })
    if (validatedAt) pdf.text(`Validación DIAN: ${new Date(validatedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`, { width: 175, align: 'right' })
    if (d.environment !== '1') pdf.fillColor('#b00').font('Helvetica-Bold').text('AMBIENTE DE PRUEBAS - SIN VALIDEZ', { width: 175, align: 'right' }).fillColor('#000').font('Helvetica')

    let y = Math.max(pdf.y, 120) + 8
    if (d.resolution) {
      pdf.fontSize(7.5).text(
        `Autorización de numeración de facturación DIAN No. ${d.resolution.number} del ${d.resolution.start}, ` +
        `prefijo ${d.resolution.prefix} del ${d.resolution.from} al ${d.resolution.to}, vigente hasta ${d.resolution.end}.`,
        left, y, { width },
      )
      y = pdf.y + 4
    }
    if (d.reference) {
      pdf.fontSize(8.5).font('Helvetica-Bold').text(`Factura referenciada: ${d.reference.number}`, left, y, { width })
      pdf.font('Helvetica').fontSize(7.5).text(`CUFE: ${d.reference.cufe}`, { width })
      pdf.text(`Concepto: Anulación de factura electrónica — ${d.reference.reason}`, { width })
      y = pdf.y + 4
    }

    // Adquiriente
    pdf.rect(left, y, width, 46).strokeColor('#999').stroke()
    pdf.fontSize(8.5).font('Helvetica-Bold').text('Adquiriente', left + 6, y + 5)
    pdf.font('Helvetica').text(`${d.customer.name}   ${d.customer.docLabel} ${d.customer.doc}`, left + 6, y + 17, { width: width - 12 })
    pdf.text([d.customer.address, d.customer.email].filter(Boolean).join(' · ') || ' ', left + 6, y + 29, { width: width - 12 })
    y += 56

    // Detalle
    const cols = [
      { label: 'Descripción', w: 0.36 }, { label: 'Cant.', w: 0.06, align: 'right' }, { label: 'Vr. unitario', w: 0.12, align: 'right' },
      { label: 'Descuento', w: 0.11, align: 'right' }, { label: 'IVA %', w: 0.07, align: 'right' }, { label: 'IVA', w: 0.12, align: 'right' },
      { label: 'Subtotal', w: 0.16, align: 'right' },
    ].map((c) => ({ ...c, w: c.w * width }))
    const row = (values, bold = false) => {
      let x = left
      const h = Math.max(...values.map((v, i) => pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).heightOfString(String(v), { width: cols[i].w - 6 }))) + 6
      if (y + h > pdf.page.height - 160) { pdf.addPage(); y = 36 }
      values.forEach((v, i) => {
        pdf.text(String(v), x + 3, y + 3, { width: cols[i].w - 6, align: cols[i].align ?? 'left' })
        x += cols[i].w
      })
      y += h
      pdf.moveTo(left, y).lineTo(left + width, y).strokeColor('#ddd').stroke()
    }
    pdf.rect(left, y, width, 16).fillColor('#f0f0f0').fill().fillColor('#000')
    row(cols.map((c) => c.label), true)
    for (const l of d.lines) {
      row([`${l.description}${l.code ? ` (${l.code})` : ''}`, l.quantity, cop(l.unitPrice), cop(l.allowance), l.rate ? `${Number(l.rate)}%` : 'Excl.', cop(l.tax), cop(l.base)])
    }

    // Totales
    y += 8
    const totalsX = left + width - 220
    const totalLine = (label, value, bold = false) => {
      pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5)
      pdf.text(label, totalsX, y, { width: 120 })
      pdf.text(value, totalsX + 120, y, { width: 100, align: 'right' })
      y += bold ? 15 : 12
    }
    totalLine('Subtotal (base)', cop(d.totals.lineExtension))
    for (const t of d.taxSubtotals) totalLine(`IVA ${Number(t.rate)}% sobre ${cop(t.taxable)}`, cop(t.tax))
    if (Number(d.totals.rounding) !== 0) totalLine('Ajuste al peso', cop(d.totals.rounding))
    totalLine('TOTAL', cop(d.totals.payable), true)
    pdf.font('Helvetica').fontSize(8).text(`Forma de pago: contado · Medio: ${PAYMENT_MEANS[d.paymentMeans] ?? d.paymentMeans}`, left, y - 27, { width: totalsX - left - 10 })

    // CUFE + QR
    y = Math.max(y, pdf.y) + 14
    if (y > pdf.page.height - 140) { pdf.addPage(); y = 36 }
    if (qrPng) pdf.image(qrPng, left, y, { width: 96 })
    pdf.fontSize(7.5).font('Helvetica-Bold').text(d.isCreditNote ? 'CUDE' : 'CUFE', left + 108, y)
    pdf.font('Helvetica').text(d.cufe, left + 108, pdf.y, { width: width - 108 })
    pdf.moveDown(0.5).text(`Consulte este documento en: ${d.qr}`, left + 108, pdf.y, { width: width - 108 })
    pdf.moveDown(0.5).text(`Documento generado por ${softwareName} — ${d.supplier.name} (NIT ${d.supplier.nit}).`, left + 108, pdf.y, { width: width - 108 })

    pdf.end()
  })
}
