import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { SignedXml } from 'xml-crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { TEST_ENV, withEnv, testCertPem } from '../helpers/einvoice.js'

vi.mock('../../src/services/email.service.js', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue(true),
  sendOrderCancelled: vi.fn().mockResolvedValue(true),
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
  sendContactNotification: vi.fn().mockResolvedValue(true),
  sendElectronicInvoice: vi.fn().mockResolvedValue(true),
  sendEinvoiceAlert: vi.fn().mockResolvedValue(true),
}))

const { prisma } = await import('../../src/config/prisma.js')
const { createOrder } = await import('../../src/services/order.service.js')
const { processPaymentUpdate, PAY } = await import('../../src/services/payment.service.js')
const { updateOrderStatus } = await import('../../src/services/admin-orders.service.js')
const Einvoice = await import('../../src/services/einvoice/einvoice.service.js')
const { DianSoapError } = await import('../../src/services/einvoice/dian-client.js')
const { sendElectronicInvoice, sendEinvoiceAlert } = await import('../../src/services/email.service.js')

const TABLES = [
  'electronic_documents', 'invoice_sequences',
  'payment_events', 'payments', 'order_status_logs', 'order_items', 'orders', 'cart_items',
  'addresses', 'refresh_tokens', 'product_variants', 'product_images', 'products', 'categories', 'users',
]

const accepted = (extra = {}) => ({
  isValid: true, statusCode: '00', statusDescription: 'Procesado Correctamente.', statusMessage: 'Autorizada',
  errors: [], applicationResponse: '<ApplicationResponse>OK</ApplicationResponse>', ...extra,
})

let dian
const fakeClient = () => {
  dian = {
    sendBillSync: vi.fn().mockResolvedValue(accepted()),
    sendTestSetAsync: vi.fn().mockResolvedValue({ zipKey: 'zip-key-1', errors: [] }),
    getStatusZip: vi.fn().mockResolvedValue([accepted()]),
    getStatus: vi.fn().mockResolvedValue(accepted()),
  }
  Einvoice.__setDianClientFactory(() => dian)
}

let restoreEnv
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`)
  vi.clearAllMocks()
  delete process.env.SHIPPING_FLAT_RATE
  delete process.env.FREE_SHIPPING_FROM
  restoreEnv = withEnv({ ...TEST_ENV, EINVOICE_ENV: '1' })
  fakeClient()
})
afterEach(() => restoreEnv())
afterAll(async () => {
  Einvoice.__setDianClientFactory(null)
  await prisma.$disconnect()
})

let seq = 0
const makeUser = () => prisma.user.create({ data: { email: `e${++seq}@test.co`, password: 'x', name: 'Cliente', emailVerified: true } })
const makeProduct = async ({ price = 119000, stock = 50, taxRate = 19 } = {}) => {
  const category = await prisma.category.upsert({ where: { slug: 'ropa' }, update: {}, create: { name: 'Ropa', slug: 'ropa' } })
  return prisma.product.create({
    data: { name: `Prenda ${++seq}`, slug: `prenda-${seq}`, description: '', price, basePrice: Math.round(price / (1 + taxRate / 100)), taxRate, stock, categoryId: category.id },
  })
}
const address = { fullName: 'Ana Pérez', phone: '3001234567', street: 'Calle 10 # 43-20', departamento: 'Antioquia', municipio: 'Envigado' }
const newOrder = async (items, extra = {}) => createOrder((await makeUser()).id, { items, address, acceptTerms: true, ...extra })
const approve = (o, id = `pay-${o.id}`) =>
  processPaymentUpdate({ provider: 'WOMPI', orderId: o.id, providerPaymentId: id, status: PAY.APPROVED, amount: Number(o.total) })

/** Espera a que el documento salga de los estados transitorios (el disparo es asíncrono). */
const settled = async (orderId, type = 'INVOICE', timeoutMs = 10_000) => {
  const until = Date.now() + timeoutMs
  for (;;) {
    const doc = await prisma.electronicDocument.findUnique({ where: { orderId_type: { orderId, type } } })
    if (doc && ['ACCEPTED', 'REJECTED', 'ERROR', 'SENT'].includes(doc.status) && (doc.status !== 'ACCEPTED' || doc.emailedAt)) return doc
    if (doc && doc.status === 'PENDING' && doc.lastError) return doc
    if (Date.now() > until) return doc
    await new Promise((r) => setTimeout(r, 50))
  }
}

const verifySignature = (xml) => {
  const dom = new DOMParser().parseFromString(xml, 'text/xml')
  const sig = new SignedXml({ publicCert: testCertPem })
  sig.loadSignature(dom.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0])
  return sig.checkSignature(xml)
}

describe('factura electrónica al aprobar el pago', () => {
  it('emite, firma, envía y entrega la factura con el primer número del rango', async () => {
    const product = await makeProduct({ price: 119000 })
    const exempt = await makeProduct({ price: 50000, taxRate: 0 })
    const o = await newOrder(
      [{ productId: product.id, quantity: 2 }, { productId: exempt.id, quantity: 1 }],
      { buyer: { docType: '31', docNumber: '800197268', name: 'EMPRESA CLIENTE S.A.S.' } },
    )
    expect(o.buyerDv).toBe('4')
    expect(o.items.map((i) => Number(i.taxRate)).sort()).toEqual([0, 19])

    await approve(o)
    const doc = await settled(o.id)

    expect(doc).toMatchObject({ status: 'ACCEPTED', prefix: 'SETP', number: 990000000, fullNumber: 'SETP990000000', environment: '1' })
    expect(doc.cufe).toMatch(/^[0-9a-f]{96}$/)
    expect(doc.xmlSigned).toContain(`<cbc:UUID schemeID="1" schemeName="CUFE-SHA384">${doc.cufe}</cbc:UUID>`)
    expect(doc.xmlSigned).toContain('schemeID="4" schemeName="31">800197268</cbc:ID>')
    expect(doc.xmlSigned).toContain('<cbc:PayableAmount currencyID="COP">288000.00</cbc:PayableAmount>')
    expect(doc.xmlSigned).toContain('<cbc:ID>05266</cbc:ID>') // Envigado (DANE)
    expect(verifySignature(doc.xmlSigned)).toBe(true)
    expect(doc.fileName).toMatch(/^fv0900373115000\d{2}00000001\.xml$/)

    const [zipName, zipB64] = dian.sendBillSync.mock.calls[0]
    expect(zipName).toBe(doc.fileName.replace(/^fv/, 'z').replace('.xml', '.zip'))
    expect(strFromU8(unzipSync(Buffer.from(zipB64, 'base64'))[doc.fileName])).toBe(doc.xmlSigned)

    expect(sendElectronicInvoice).toHaveBeenCalledTimes(1)
    const mail = sendElectronicInvoice.mock.calls[0][0]
    expect(mail).toMatchObject({ fullNumber: 'SETP990000000', isCreditNote: false, name: 'EMPRESA CLIENTE S.A.S.' })
    expect(mail.pdfBuffer.subarray(0, 5).toString()).toBe('%PDF-')
    const files = unzipSync(new Uint8Array(mail.zipBuffer))
    const adName = Object.keys(files).find((n) => n.startsWith('ad'))
    expect(strFromU8(files[adName])).toContain('<cbc:DocumentType>Contenedor de Factura Electrónica</cbc:DocumentType>')
    expect(doc.emailedAt).not.toBeNull()
  })

  it('factura a consumidor final cuando no se dan datos', async () => {
    const product = await makeProduct()
    const o = await newOrder([{ productId: product.id, quantity: 1 }])
    await approve(o)
    const doc = await settled(o.id)
    expect(doc.status).toBe('ACCEPTED')
    expect(doc.xmlSigned).toContain('schemeName="13">222222222222</cbc:ID>')
    expect(doc.xmlSigned).toContain('<cbc:RegistrationName>consumidor final</cbc:RegistrationName>')
  })

  it('numera sin huecos ni duplicados con pagos concurrentes', async () => {
    const product = await makeProduct()
    const orders = []
    for (let i = 0; i < 8; i++) orders.push(await newOrder([{ productId: product.id, quantity: 1 }]))
    await Promise.all(orders.map((o) => approve(o)))
    await Promise.all(orders.map((o) => Einvoice.enqueueInvoice(o.id))) // doble encolado: idempotente
    await Einvoice.processPending()
    const docs = await Promise.all(orders.map((o) => settled(o.id)))
    expect(docs.every((d) => d.status === 'ACCEPTED')).toBe(true)
    const numbers = docs.map((d) => d.number).sort((a, b) => a - b)
    expect(numbers).toEqual([990000000, 990000001, 990000002, 990000003, 990000004, 990000005, 990000006, 990000007])
    expect(await prisma.electronicDocument.count()).toBe(8)
    expect(dian.sendBillSync).toHaveBeenCalledTimes(8)
  })

  it('un webhook repetido no genera otra factura', async () => {
    const product = await makeProduct()
    const o = await newOrder([{ productId: product.id, quantity: 1 }])
    await approve(o, 'pay-1')
    await approve(o, 'pay-1')
    await settled(o.id)
    expect(await prisma.electronicDocument.count({ where: { orderId: o.id } })).toBe(1)
  })

  it('no hace nada si la facturación está apagada', async () => {
    restoreEnv()
    restoreEnv = withEnv({ EINVOICE_ENABLED: 'false' })
    const product = await makeProduct()
    const o = await newOrder([{ productId: product.id, quantity: 1 }])
    await approve(o)
    await new Promise((r) => setTimeout(r, 200))
    expect(await prisma.electronicDocument.count()).toBe(0)
    expect(dian.sendBillSync).not.toHaveBeenCalled()
  })
})

describe('errores y reintentos', () => {
  it('rechazo de la DIAN: queda REJECTED, avisa al admin y el reintento conserva el número', async () => {
    dian.sendBillSync.mockResolvedValueOnce({
      isValid: false, statusCode: '99', statusDescription: 'Validación contiene errores', errors: ['Regla: FAK24, Rechazo: DV del NIT del adquiriente no es correcto'], applicationResponse: null,
    })
    const product = await makeProduct()
    const o = await newOrder([{ productId: product.id, quantity: 1 }])
    await approve(o)
    const rejected = await settled(o.id)
    expect(rejected.status).toBe('REJECTED')
    expect(rejected.lastError).toContain('FAK24')
    expect(sendEinvoiceAlert).toHaveBeenCalledWith(expect.objectContaining({ fullNumber: 'SETP990000000', errors: [expect.stringContaining('FAK24')] }))
    expect(sendElectronicInvoice).not.toHaveBeenCalled()

    const result = await Einvoice.retryDocument(rejected.id)
    const doc = await settled(o.id)
    expect(doc).toMatchObject({ status: 'ACCEPTED', number: 990000000 })
    expect(result.documents[0].status).toBe('ACCEPTED')
    expect(dian.sendBillSync).toHaveBeenCalledTimes(2)
  })

  it('error de red: queda ERROR con reintento programado y el job lo completa', async () => {
    dian.sendBillSync.mockRejectedValueOnce(new DianSoapError('No se pudo conectar con la DIAN: ETIMEDOUT'))
    const product = await makeProduct()
    const o = await newOrder([{ productId: product.id, quantity: 1 }])
    await approve(o)
    const failed = await settled(o.id)
    expect(failed.status).toBe('ERROR')
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())

    await prisma.electronicDocument.update({ where: { id: failed.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })
    await Einvoice.processPending()
    const doc = await settled(o.id)
    expect(doc.status).toBe('ACCEPTED')
    // Se reenvía exactamente el mismo XML (mismo CUFE) que en el primer intento.
    expect(doc.cufe).toBe(failed.cufe)
  })

  it('reenvío de un documento ya recibido por la DIAN: consulta el estado y lo acepta', async () => {
    dian.sendBillSync.mockResolvedValueOnce({ isValid: false, statusCode: '99', errors: ['Regla: 90, Rechazo: Documento procesado anteriormente.'], applicationResponse: null })
    const product = await makeProduct()
    const o = await newOrder([{ productId: product.id, quantity: 1 }])
    await approve(o)
    const doc = await settled(o.id)
    expect(doc.status).toBe('ACCEPTED')
    expect(dian.getStatus).toHaveBeenCalledWith(doc.cufe)
  })

  it('configuración incompleta: no bloquea la venta y deja el documento en ERROR', async () => {
    restoreEnv()
    restoreEnv = withEnv({ ...TEST_ENV, EINVOICE_ENV: '1', EINVOICE_TECHNICAL_KEY: undefined })
    const product = await makeProduct()
    const o = await newOrder([{ productId: product.id, quantity: 1 }])
    const res = await approve(o)
    expect(res.outcome).toBe('CONFIRMED')
    const doc = await settled(o.id)
    expect(doc.status).toBe('ERROR')
    expect(doc.lastError).toContain('EINVOICE_TECHNICAL_KEY')
    expect(doc.nextAttemptAt).not.toBeNull()
  })

  it('rango agotado: error claro sin consumir números fuera de la resolución', async () => {
    restoreEnv()
    restoreEnv = withEnv({ ...TEST_ENV, EINVOICE_ENV: '1', EINVOICE_RANGE_FROM: '1', EINVOICE_RANGE_TO: '1' })
    const product = await makeProduct()
    const a = await newOrder([{ productId: product.id, quantity: 1 }])
    const b = await newOrder([{ productId: product.id, quantity: 1 }])
    await approve(a)
    expect((await settled(a.id)).number).toBe(1)
    await approve(b)
    const doc = await settled(b.id)
    expect(doc.status).toBe('ERROR')
    expect(doc.number).toBeNull()
    expect(doc.lastError).toContain('Se agotó el rango')
  })
})

describe('nota crédito', () => {
  it('al cancelar una orden facturada emite la nota crédito que referencia la factura', async () => {
    const product = await makeProduct()
    const o = await newOrder([{ productId: product.id, quantity: 2 }])
    await approve(o)
    const invoice = await settled(o.id)

    await updateOrderStatus(o.id, 'CANCELLED', { note: 'Cliente desistió' })
    Einvoice.triggerCreditNote(o.id, 'Pedido cancelado')
    const note = await settled(o.id, 'CREDIT_NOTE')

    expect(note).toMatchObject({ status: 'ACCEPTED', prefix: 'NC', number: 1, fullNumber: 'NC1', referenceId: invoice.id })
    expect(note.xmlSigned).toContain('<CreditNote ')
    expect(note.xmlSigned).toContain(`<cbc:UUID schemeName="CUFE-SHA384">${invoice.cufe}</cbc:UUID>`)
    expect(note.xmlSigned).toContain(`<cbc:UUID schemeID="1" schemeName="CUDE-SHA384">${note.cufe}</cbc:UUID>`)
    expect(note.xmlSigned).toContain('<cbc:PayableAmount currencyID="COP">238000.00</cbc:PayableAmount>')
    expect(verifySignature(note.xmlSigned)).toBe(true)
    expect(sendElectronicInvoice).toHaveBeenLastCalledWith(expect.objectContaining({ fullNumber: 'NC1', isCreditNote: true }))
  })

  it('espera a que la factura sea aceptada antes de emitir la nota crédito', async () => {
    dian.sendBillSync.mockRejectedValueOnce(new DianSoapError('DIAN caída'))
    const product = await makeProduct()
    const o = await newOrder([{ productId: product.id, quantity: 1 }])
    await approve(o)
    expect((await settled(o.id)).status).toBe('ERROR')

    const note = await Einvoice.enqueueCreditNote(o.id, 'Pedido cancelado')
    await Einvoice.processDocument(note.id)
    const waiting = await prisma.electronicDocument.findUnique({ where: { id: note.id } })
    expect(waiting).toMatchObject({ status: 'PENDING', number: null })
    expect(waiting.lastError).toContain('Esperando')
  })

  it('una orden sin factura (pagada antes de activar) no genera nota crédito', async () => {
    expect(await Einvoice.enqueueCreditNote('orden-inexistente', 'x')).toBeNull()
  })
})

describe('habilitación (set de pruebas)', () => {
  it('envía con SendTestSetAsync, queda SENT y el job consulta GetStatusZip hasta aceptarla', async () => {
    restoreEnv()
    restoreEnv = withEnv({ ...TEST_ENV, EINVOICE_ENV: '2' })
    dian.getStatusZip
      .mockResolvedValueOnce([{ isValid: false, statusCode: null, statusDescription: 'Batch en proceso de validación.', errors: [] }])
      .mockResolvedValueOnce([accepted()])

    const product = await makeProduct()
    const o = await newOrder([{ productId: product.id, quantity: 1 }])
    await approve(o)
    let doc = await settled(o.id)
    expect(doc).toMatchObject({ status: 'SENT', trackId: 'zip-key-1', environment: '2' })
    expect(dian.sendTestSetAsync).toHaveBeenCalledWith(expect.stringMatching(/^z.*\.zip$/), expect.any(String), TEST_ENV.EINVOICE_TEST_SET_ID)
    expect(doc.xmlSigned).toContain('<cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>')

    const due = () => prisma.electronicDocument.update({ where: { id: doc.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })
    await due()
    await Einvoice.processPending()
    expect((await prisma.electronicDocument.findUnique({ where: { id: doc.id } })).status).toBe('SENT')

    await due()
    await Einvoice.processPending()
    doc = await settled(o.id)
    expect(doc.status).toBe('ACCEPTED')
    expect(dian.getStatusZip).toHaveBeenCalledWith('zip-key-1')
  })
})
