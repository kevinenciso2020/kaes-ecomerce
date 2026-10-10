// Generación de los XML UBL 2.1 con las extensiones DIAN (Anexo Técnico 1.9).
// Funciones puras: reciben datos ya calculados y devuelven el XML sin firmar.
// El orden de los elementos sigue el XSD de UBL 2.1 (la DIAN rechaza otro orden).
import { formatMoney } from './amounts.js'

const NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  creditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  debitNote: 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2',
  attached: 'urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2',
}

const COMMON_NS =
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" ' +
  'xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ' +
  'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" ' +
  'xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1" ' +
  'xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" ' +
  'xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'

const DIAN = 'schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"'

export const FINAL_CONSUMER = {
  docType: '13',
  docNumber: '222222222222',
  name: 'consumidor final',
  personType: '2',
}

export const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const money = (cents) => `currencyID="COP">${formatMoney(cents)}`
const pct = (rate) => Number(rate).toFixed(2)

const companyId = (tag, { docNumber, docType, dv }) =>
  `<cbc:${tag} ${DIAN}${docType === '31' && dv != null ? ` schemeID="${esc(dv)}"` : ''} schemeName="${esc(docType)}">${esc(docNumber)}</cbc:${tag}>`

const address = (tag, loc, line) =>
  `<cac:${tag}>` +
  `<cbc:ID>${loc.cityCode}</cbc:ID>` +
  `<cbc:CityName>${esc(loc.cityName)}</cbc:CityName>` +
  (loc.postalZone ? `<cbc:PostalZone>${esc(loc.postalZone)}</cbc:PostalZone>` : '') +
  `<cbc:CountrySubentity>${esc(loc.departmentName)}</cbc:CountrySubentity>` +
  `<cbc:CountrySubentityCode>${loc.departmentCode}</cbc:CountrySubentityCode>` +
  `<cac:AddressLine><cbc:Line>${esc(line)}</cbc:Line></cac:AddressLine>` +
  '<cac:Country><cbc:IdentificationCode>CO</cbc:IdentificationCode><cbc:Name languageID="es">Colombia</cbc:Name></cac:Country>' +
  `</cac:${tag}>`

const TAX_SCHEME_NAMES = { '01': 'IVA', '04': 'INC', ZA: 'IVA e INC', ZZ: 'No aplica' }
const taxScheme = (id) => `<cac:TaxScheme><cbc:ID>${esc(id)}</cbc:ID><cbc:Name>${esc(TAX_SCHEME_NAMES[id] ?? id)}</cbc:Name></cac:TaxScheme>`
// listName 48 = responsable de IVA, 49 = no responsable (tabla 13.2.6.1).
const taxLevel = (code, schemeId) => `<cbc:TaxLevelCode listName="${schemeId === '01' || schemeId === 'ZA' ? '48' : '49'}">${esc(code)}</cbc:TaxLevelCode>`

const supplierParty = (issuer, resolution) => {
  const id = { docNumber: issuer.nit, docType: '31', dv: issuer.dv }
  const loc = { ...issuer.location, postalZone: issuer.postalZone }
  return (
    '<cac:AccountingSupplierParty>' +
    `<cbc:AdditionalAccountID>${esc(issuer.personType)}</cbc:AdditionalAccountID>` +
    '<cac:Party>' +
    `<cac:PartyName><cbc:Name>${esc(issuer.tradeName)}</cbc:Name></cac:PartyName>` +
    `<cac:PhysicalLocation>${address('Address', loc, issuer.address)}</cac:PhysicalLocation>` +
    '<cac:PartyTaxScheme>' +
    `<cbc:RegistrationName>${esc(issuer.name)}</cbc:RegistrationName>` +
    companyId('CompanyID', id) +
    taxLevel(issuer.taxLevelCode, issuer.taxSchemeId) +
    address('RegistrationAddress', loc, issuer.address) +
    taxScheme(issuer.taxSchemeId) +
    '</cac:PartyTaxScheme>' +
    '<cac:PartyLegalEntity>' +
    `<cbc:RegistrationName>${esc(issuer.name)}</cbc:RegistrationName>` +
    companyId('CompanyID', id) +
    (resolution
      ? `<cac:CorporateRegistrationScheme><cbc:ID>${esc(resolution.prefix)}</cbc:ID>${issuer.commercialRegistration ? `<cbc:Name>${esc(issuer.commercialRegistration)}</cbc:Name>` : ''}</cac:CorporateRegistrationScheme>`
      : '') +
    '</cac:PartyLegalEntity>' +
    '<cac:Contact>' +
    (issuer.phone ? `<cbc:Telephone>${esc(issuer.phone)}</cbc:Telephone>` : '') +
    `<cbc:ElectronicMail>${esc(issuer.email)}</cbc:ElectronicMail>` +
    '</cac:Contact>' +
    '</cac:Party>' +
    '</cac:AccountingSupplierParty>'
  )
}

/**
 * buyer: { docType, docNumber, dv, name, personType, email, location, addressLine }
 * Sin documento → consumidor final (222222222222, tipo 13, R-99-PN, ZZ).
 */
export const normalizeBuyer = (buyer = {}) => {
  const hasDoc = Boolean(buyer.docType && buyer.docNumber)
  return {
    ...(hasDoc ? buyer : FINAL_CONSUMER),
    isFinalConsumer: !hasDoc,
    name: hasDoc ? buyer.name : FINAL_CONSUMER.name,
    personType: hasDoc ? (buyer.personType || (buyer.docType === '31' ? '1' : '2')) : '2',
    email: buyer.email ?? null,
    location: buyer.location ?? null,
    addressLine: buyer.addressLine ?? null,
  }
}

const customerParty = (buyer) => {
  const id = { docNumber: buyer.docNumber, docType: buyer.docType, dv: buyer.dv }
  return (
    '<cac:AccountingCustomerParty>' +
    `<cbc:AdditionalAccountID>${esc(buyer.personType)}</cbc:AdditionalAccountID>` +
    '<cac:Party>' +
    `<cac:PartyIdentification>${companyId('ID', id)}</cac:PartyIdentification>` +
    `<cac:PartyName><cbc:Name>${esc(buyer.name)}</cbc:Name></cac:PartyName>` +
    // Venta fuera de establecimiento (comercio electrónico): se informa la dirección de entrega.
    (buyer.location && buyer.addressLine ? `<cac:PhysicalLocation>${address('Address', buyer.location, buyer.addressLine)}</cac:PhysicalLocation>` : '') +
    '<cac:PartyTaxScheme>' +
    `<cbc:RegistrationName>${esc(buyer.name)}</cbc:RegistrationName>` +
    companyId('CompanyID', id) +
    taxLevel('R-99-PN', 'ZZ') +
    taxScheme('ZZ') +
    '</cac:PartyTaxScheme>' +
    '<cac:PartyLegalEntity>' +
    `<cbc:RegistrationName>${esc(buyer.name)}</cbc:RegistrationName>` +
    companyId('CompanyID', id) +
    '</cac:PartyLegalEntity>' +
    (buyer.email ? `<cac:Contact><cbc:ElectronicMail>${esc(buyer.email)}</cbc:ElectronicMail></cac:Contact>` : '') +
    '</cac:Party>' +
    '</cac:AccountingCustomerParty>'
  )
}

const dianExtensions = ({ config, fullNumber, securityCode, qr, withInvoiceControl }) => {
  const { resolution, software, issuer } = config
  return (
    '<ext:UBLExtension><ext:ExtensionContent><sts:DianExtensions>' +
    (withInvoiceControl
      ? '<sts:InvoiceControl>' +
        `<sts:InvoiceAuthorization>${esc(resolution.number)}</sts:InvoiceAuthorization>` +
        `<sts:AuthorizationPeriod><cbc:StartDate>${esc(resolution.startDate)}</cbc:StartDate><cbc:EndDate>${esc(resolution.endDate)}</cbc:EndDate></sts:AuthorizationPeriod>` +
        `<sts:AuthorizedInvoices><sts:Prefix>${esc(resolution.prefix)}</sts:Prefix><sts:From>${resolution.from}</sts:From><sts:To>${resolution.to}</sts:To></sts:AuthorizedInvoices>` +
        '</sts:InvoiceControl>'
      : '') +
    '<sts:InvoiceSource><cbc:IdentificationCode listAgencyID="6" listAgencyName="United Nations Economic Commission for Europe" listSchemeURI="urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1">CO</cbc:IdentificationCode></sts:InvoiceSource>' +
    '<sts:SoftwareProvider>' +
    `<sts:ProviderID ${DIAN} schemeID="${esc(issuer.dv)}" schemeName="31">${esc(issuer.nit)}</sts:ProviderID>` +
    `<sts:SoftwareID ${DIAN}>${esc(software.id)}</sts:SoftwareID>` +
    '</sts:SoftwareProvider>' +
    `<sts:SoftwareSecurityCode ${DIAN}>${securityCode}</sts:SoftwareSecurityCode>` +
    `<sts:AuthorizationProvider><sts:AuthorizationProviderID ${DIAN} schemeID="4" schemeName="31">800197268</sts:AuthorizationProviderID></sts:AuthorizationProvider>` +
    `<sts:QRCode>${esc(qr)}</sts:QRCode>` +
    '</sts:DianExtensions></ext:ExtensionContent></ext:UBLExtension>' +
    // Segunda extensión: aquí se inserta la firma XAdES.
    '<ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension>'
  )
}

const taxTotals = (amounts) => {
  if (!amounts.taxSubtotals.length) return ''
  return (
    '<cac:TaxTotal>' +
    `<cbc:TaxAmount ${money(amounts.totals.taxTotal)}</cbc:TaxAmount>` +
    amounts.taxSubtotals
      .map(
        (t) =>
          '<cac:TaxSubtotal>' +
          `<cbc:TaxableAmount ${money(t.taxable)}</cbc:TaxableAmount>` +
          `<cbc:TaxAmount ${money(t.tax)}</cbc:TaxAmount>` +
          `<cac:TaxCategory><cbc:Percent>${pct(t.rate)}</cbc:Percent>${taxScheme('01')}</cac:TaxCategory>` +
          '</cac:TaxSubtotal>',
      )
      .join('') +
    '</cac:TaxTotal>'
  )
}

const monetaryTotal = (totals, tag = 'LegalMonetaryTotal') =>
  `<cac:${tag}>` +
  `<cbc:LineExtensionAmount ${money(totals.lineExtension)}</cbc:LineExtensionAmount>` +
  `<cbc:TaxExclusiveAmount ${money(totals.taxExclusive)}</cbc:TaxExclusiveAmount>` +
  `<cbc:TaxInclusiveAmount ${money(totals.taxInclusive)}</cbc:TaxInclusiveAmount>` +
  (totals.rounding !== 0
    ? `<cbc:PayableRoundingAmount currencyID="COP">${totals.rounding < 0 ? '-' : ''}${formatMoney(Math.abs(totals.rounding))}</cbc:PayableRoundingAmount>`
    : '') +
  `<cbc:PayableAmount ${money(totals.payable)}</cbc:PayableAmount>` +
  `</cac:${tag}>`

const lineAllowance = (line) =>
  line.allowance > 0
    ? '<cac:AllowanceCharge>' +
      '<cbc:ID>1</cbc:ID>' +
      '<cbc:ChargeIndicator>false</cbc:ChargeIndicator>' +
      '<cbc:AllowanceChargeReason>Descuento por cupón</cbc:AllowanceChargeReason>' +
      `<cbc:MultiplierFactorNumeric>${((line.allowance * 100) / (line.unitPrice * line.quantity)).toFixed(2)}</cbc:MultiplierFactorNumeric>` +
      `<cbc:Amount ${money(line.allowance)}</cbc:Amount>` +
      `<cbc:BaseAmount ${money(line.unitPrice * line.quantity)}</cbc:BaseAmount>` +
      '</cac:AllowanceCharge>'
    : ''

const lineTax = (line) =>
  line.taxMode !== 'excluded'
    ? '<cac:TaxTotal>' +
      `<cbc:TaxAmount ${money(line.tax)}</cbc:TaxAmount>` +
      '<cac:TaxSubtotal>' +
      `<cbc:TaxableAmount ${money(line.base)}</cbc:TaxableAmount>` +
      `<cbc:TaxAmount ${money(line.tax)}</cbc:TaxAmount>` +
      `<cac:TaxCategory><cbc:Percent>${pct(line.rate)}</cbc:Percent>${taxScheme('01')}</cac:TaxCategory>` +
      '</cac:TaxSubtotal>' +
      '</cac:TaxTotal>'
    : ''

// En InvoiceLine el XSD exige AllowanceCharge → TaxTotal; en CreditNoteLine/DebitNoteLine, TaxTotal → AllowanceCharge.
const documentLine = (tag, quantityTag, line, index) =>
  `<cac:${tag}>` +
  `<cbc:ID>${index + 1}</cbc:ID>` +
  `<cbc:${quantityTag} unitCode="94">${line.quantity}</cbc:${quantityTag}>` +
  `<cbc:LineExtensionAmount ${money(line.base)}</cbc:LineExtensionAmount>` +
  (tag === 'InvoiceLine' ? lineAllowance(line) + lineTax(line) : lineTax(line) + lineAllowance(line)) +
  '<cac:Item>' +
  `<cbc:Description>${esc(line.description)}</cbc:Description>` +
  `<cac:SellersItemIdentification><cbc:ID>${esc(line.code)}</cbc:ID></cac:SellersItemIdentification>` +
  // 999 = estándar de adopción del contribuyente (código interno).
  `<cac:StandardItemIdentification><cbc:ID schemeID="999">${esc(line.code)}</cbc:ID></cac:StandardItemIdentification>` +
  '</cac:Item>' +
  `<cac:Price><cbc:PriceAmount ${money(line.unitPrice)}</cbc:PriceAmount><cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity></cac:Price>` +
  `</cac:${tag}>`

const paymentMeans = (code, paymentDate) =>
  '<cac:PaymentMeans>' +
  '<cbc:ID>1</cbc:ID>' + // 1 = contado
  `<cbc:PaymentMeansCode>${esc(code)}</cbc:PaymentMeansCode>` +
  (paymentDate ? `<cbc:PaymentDueDate>${paymentDate}</cbc:PaymentDueDate>` : '') +
  '</cac:PaymentMeans>'

/**
 * @param {object} p
 * @param {object} p.config      getConfig()
 * @param {object} p.doc         { fullNumber, issueDate, issueTime, cufe, securityCode, qr, orderId, note }
 * @param {object} p.buyer       normalizeBuyer(...)
 * @param {object} p.amounts     computeInvoiceAmounts(...)
 */
export const buildInvoiceXml = ({ config, doc, buyer, amounts }) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
  `<Invoice xmlns="${NS.invoice}" ${COMMON_NS}>` +
  `<ext:UBLExtensions>${dianExtensions({ config, fullNumber: doc.fullNumber, securityCode: doc.securityCode, qr: doc.qr, withInvoiceControl: true })}</ext:UBLExtensions>` +
  '<cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>' +
  '<cbc:CustomizationID>10</cbc:CustomizationID>' + // 10 = Estándar
  '<cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>' +
  `<cbc:ProfileExecutionID>${config.environment}</cbc:ProfileExecutionID>` +
  `<cbc:ID>${esc(doc.fullNumber)}</cbc:ID>` +
  `<cbc:UUID schemeID="${config.environment}" schemeName="CUFE-SHA384">${doc.cufe}</cbc:UUID>` +
  `<cbc:IssueDate>${doc.issueDate}</cbc:IssueDate>` +
  `<cbc:IssueTime>${doc.issueTime}</cbc:IssueTime>` +
  '<cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>' +
  (doc.note ? `<cbc:Note>${esc(doc.note)}</cbc:Note>` : '') +
  '<cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>' +
  `<cbc:LineCountNumeric>${amounts.lines.length}</cbc:LineCountNumeric>` +
  (doc.orderId ? `<cac:OrderReference><cbc:ID>${esc(doc.orderId)}</cbc:ID></cac:OrderReference>` : '') +
  supplierParty(config.issuer, config.resolution) +
  customerParty(buyer) +
  paymentMeans(config.paymentMeansCode, doc.issueDate) +
  taxTotals(amounts) +
  monetaryTotal(amounts.totals) +
  amounts.lines.map((l, i) => documentLine('InvoiceLine', 'InvoicedQuantity', l, i)).join('') +
  '</Invoice>'

const NOTE_KINDS = {
  credit: {
    root: 'CreditNote', ns: NS.creditNote, customization: '20', // 20 = referencia una factura electrónica
    profile: 'DIAN 2.1: Nota Crédito de Factura Electrónica de Venta',
    typeCode: '<cbc:CreditNoteTypeCode>91</cbc:CreditNoteTypeCode>',
    responseCode: '2', // 2 = anulación de factura electrónica (tabla 13.2.4)
    defaultReason: 'Anulación de factura electrónica',
    line: ['CreditNoteLine', 'CreditedQuantity'], total: 'LegalMonetaryTotal',
  },
  debit: {
    root: 'DebitNote', ns: NS.debitNote, customization: '30', // 30 = referencia una factura electrónica
    profile: 'DIAN 2.1: Nota Débito de Factura Electrónica de Venta',
    typeCode: '',
    responseCode: '4', // 4 = otros (tabla 13.2.5)
    defaultReason: 'Ajuste a la factura electrónica',
    line: ['DebitNoteLine', 'DebitedQuantity'], total: 'RequestedMonetaryTotal',
  },
}

const buildNoteXml = (kind, { config, doc, buyer, amounts }) => {
  const k = NOTE_KINDS[kind]
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
    `<${k.root} xmlns="${k.ns}" ${COMMON_NS}>` +
    `<ext:UBLExtensions>${dianExtensions({ config, fullNumber: doc.fullNumber, securityCode: doc.securityCode, qr: doc.qr, withInvoiceControl: false })}</ext:UBLExtensions>` +
    '<cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>' +
    `<cbc:CustomizationID>${k.customization}</cbc:CustomizationID>` +
    `<cbc:ProfileID>${k.profile}</cbc:ProfileID>` +
    `<cbc:ProfileExecutionID>${config.environment}</cbc:ProfileExecutionID>` +
    `<cbc:ID>${esc(doc.fullNumber)}</cbc:ID>` +
    `<cbc:UUID schemeID="${config.environment}" schemeName="CUDE-SHA384">${doc.cufe}</cbc:UUID>` +
    `<cbc:IssueDate>${doc.issueDate}</cbc:IssueDate>` +
    `<cbc:IssueTime>${doc.issueTime}</cbc:IssueTime>` +
    k.typeCode +
    (doc.note ? `<cbc:Note>${esc(doc.note)}</cbc:Note>` : '') +
    '<cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>' +
    `<cbc:LineCountNumeric>${amounts.lines.length}</cbc:LineCountNumeric>` +
    '<cac:DiscrepancyResponse>' +
    `<cbc:ReferenceID>${esc(doc.invoice.fullNumber)}</cbc:ReferenceID>` +
    `<cbc:ResponseCode>${doc.responseCode ?? k.responseCode}</cbc:ResponseCode>` +
    `<cbc:Description>${esc(doc.reason || k.defaultReason)}</cbc:Description>` +
    '</cac:DiscrepancyResponse>' +
    (doc.orderId ? `<cac:OrderReference><cbc:ID>${esc(doc.orderId)}</cbc:ID></cac:OrderReference>` : '') +
    '<cac:BillingReference><cac:InvoiceDocumentReference>' +
    `<cbc:ID>${esc(doc.invoice.fullNumber)}</cbc:ID>` +
    `<cbc:UUID schemeName="CUFE-SHA384">${doc.invoice.cufe}</cbc:UUID>` +
    `<cbc:IssueDate>${doc.invoice.issueDate}</cbc:IssueDate>` +
    '</cac:InvoiceDocumentReference></cac:BillingReference>' +
    supplierParty(config.issuer, null) +
    customerParty(buyer) +
    paymentMeans(config.paymentMeansCode, doc.issueDate) +
    taxTotals(amounts) +
    monetaryTotal(amounts.totals, k.total) +
    amounts.lines.map((l, i) => documentLine(k.line[0], k.line[1], l, i)).join('') +
    `</${k.root}>`
  )
}

/**
 * Nota crédito que referencia la factura (por defecto concepto 2 = anulación total).
 * doc.invoice: { fullNumber, cufe, issueDate }
 */
export const buildCreditNoteXml = (p) => buildNoteXml('credit', p)

/** Nota débito que referencia la factura (requerida por el set de pruebas de habilitación). */
export const buildDebitNoteXml = (p) => buildNoteXml('debit', p)

const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`

const attachedParty = (tag, { name, docNumber, docType, dv, taxLevelCode, taxSchemeId }) =>
  `<cac:${tag}><cac:PartyTaxScheme>` +
  `<cbc:RegistrationName>${esc(name)}</cbc:RegistrationName>` +
  companyId('CompanyID', { docNumber, docType, dv }) +
  taxLevel(taxLevelCode, taxSchemeId) +
  taxScheme(taxSchemeId) +
  `</cac:PartyTaxScheme></cac:${tag}>`

/**
 * Contenedor que se entrega al adquiriente: factura firmada + respuesta de la DIAN.
 * p.validation: { date, time } de la respuesta de la DIAN.
 */
export const buildAttachedDocument = ({ config, doc, buyer, signedXml, applicationResponse, validation }) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
  `<AttachedDocument xmlns="${NS.attached}" ${COMMON_NS}>` +
  '<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>' +
  '<cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>' +
  '<cbc:CustomizationID>Documentos adjuntos</cbc:CustomizationID>' +
  '<cbc:ProfileID>Factura Electrónica de Venta</cbc:ProfileID>' +
  `<cbc:ProfileExecutionID>${config.environment}</cbc:ProfileExecutionID>` +
  `<cbc:ID>${esc(doc.fullNumber)}</cbc:ID>` +
  `<cbc:IssueDate>${doc.issueDate}</cbc:IssueDate>` +
  `<cbc:IssueTime>${doc.issueTime}</cbc:IssueTime>` +
  '<cbc:DocumentType>Contenedor de Factura Electrónica</cbc:DocumentType>' +
  `<cbc:ParentDocumentID>${esc(doc.fullNumber)}</cbc:ParentDocumentID>` +
  attachedParty('SenderParty', { name: config.issuer.name, docNumber: config.issuer.nit, docType: '31', dv: config.issuer.dv, taxLevelCode: config.issuer.taxLevelCode, taxSchemeId: config.issuer.taxSchemeId }) +
  attachedParty('ReceiverParty', { ...buyer, taxLevelCode: 'R-99-PN', taxSchemeId: 'ZZ' }) +
  '<cac:Attachment><cac:ExternalReference>' +
  '<cbc:MimeCode>text/xml</cbc:MimeCode><cbc:EncodingCode>UTF-8</cbc:EncodingCode>' +
  `<cbc:Description>${cdata(signedXml)}</cbc:Description>` +
  '</cac:ExternalReference></cac:Attachment>' +
  '<cac:ParentDocumentLineReference>' +
  '<cbc:LineID>1</cbc:LineID>' +
  '<cac:DocumentReference>' +
  `<cbc:ID>${esc(doc.fullNumber)}</cbc:ID>` +
  `<cbc:UUID schemeName="${doc.type === 'CREDIT_NOTE' ? 'CUDE-SHA384' : 'CUFE-SHA384'}">${doc.cufe}</cbc:UUID>` +
  `<cbc:IssueDate>${doc.issueDate}</cbc:IssueDate>` +
  '<cbc:DocumentType>ApplicationResponse</cbc:DocumentType>' +
  '<cac:Attachment><cac:ExternalReference>' +
  '<cbc:MimeCode>text/xml</cbc:MimeCode><cbc:EncodingCode>UTF-8</cbc:EncodingCode>' +
  `<cbc:Description>${cdata(applicationResponse ?? '')}</cbc:Description>` +
  '</cac:ExternalReference></cac:Attachment>' +
  '<cac:ResultOfVerification>' +
  '<cbc:ValidatorID>Unidad Especial Dirección de Impuestos y Aduanas Nacionales</cbc:ValidatorID>' +
  '<cbc:ValidationResultCode>02</cbc:ValidationResultCode>' +
  `<cbc:ValidationDate>${validation.date}</cbc:ValidationDate>` +
  `<cbc:ValidationTime>${validation.time}</cbc:ValidationTime>` +
  '</cac:ResultOfVerification>' +
  '</cac:DocumentReference>' +
  '</cac:ParentDocumentLineReference>' +
  '</AttachedDocument>'
