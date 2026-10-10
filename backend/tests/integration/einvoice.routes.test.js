import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: { user: { findFirst: vi.fn() } },
}))

vi.mock('../../src/services/einvoice/einvoice.service.js', () => ({
  getDocumentsForOrder: vi.fn(),
  retryDocument: vi.fn(),
  getDocumentXml: vi.fn(),
  getDocumentPdf: vi.fn(),
  getCustomerInvoicePdf: vi.fn(),
  triggerInvoice: vi.fn(),
  triggerCreditNote: vi.fn(),
  processPending: vi.fn(),
}))

vi.mock('../../src/services/admin-orders.service.js', () => ({
  updateOrderStatus: vi.fn(),
}))
vi.mock('../../src/services/email.service.js', () => ({
  sendOrderCancelled: vi.fn().mockResolvedValue(true),
}))

import request from 'supertest'
import * as AdminOrdersService from '../../src/services/admin-orders.service.js'
import app from '../../src/app.js'
import { prisma } from '../../src/config/prisma.js'
import * as Einvoice from '../../src/services/einvoice/einvoice.service.js'

const token = (role = 'ADMIN', id = 'a1') => jwt.sign({ id, email: `${id}@a.com`, role }, process.env.JWT_SECRET, { expiresIn: '15m' })

beforeEach(() => {
  vi.resetAllMocks()
  prisma.user.findFirst.mockResolvedValue({ id: 'a1' })
})

describe('admin — facturación electrónica', () => {
  it('GET /admin/orders/:id/einvoice devuelve los documentos', async () => {
    Einvoice.getDocumentsForOrder.mockResolvedValue({ enabled: true, documents: [{ id: 'd1', status: 'ACCEPTED' }] })
    const res = await request(app).get('/api/v1/admin/orders/o1/einvoice').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: true, documents: [{ id: 'd1', status: 'ACCEPTED' }] })
    expect(Einvoice.getDocumentsForOrder).toHaveBeenCalledWith('o1')
  })

  it('requiere rol de administrador', async () => {
    const res = await request(app).get('/api/v1/admin/orders/o1/einvoice').set('Authorization', `Bearer ${token('CUSTOMER')}`)
    expect(res.status).toBe(403)
    expect(Einvoice.getDocumentsForOrder).not.toHaveBeenCalled()
  })

  it('POST /admin/einvoice/:docId/retry reintenta el documento', async () => {
    Einvoice.retryDocument.mockResolvedValue({ enabled: true, documents: [{ id: 'd1', status: 'ACCEPTED' }] })
    const res = await request(app).post('/api/v1/admin/einvoice/d1/retry').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(200)
    expect(Einvoice.retryDocument).toHaveBeenCalledWith('d1')
  })

  it('el reintento de un documento aceptado responde 409', async () => {
    Einvoice.retryDocument.mockRejectedValue(Object.assign(new Error('Solo se pueden reintentar documentos rechazados o con error'), { status: 409 }))
    const res = await request(app).post('/api/v1/admin/einvoice/d1/retry').set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(409)
  })

  it('descarga el XML y el PDF como adjuntos', async () => {
    Einvoice.getDocumentXml.mockResolvedValue({ xml: '<Invoice/>', fileName: 'fv0900373115000260000001.xml' })
    const xml = await request(app).get('/api/v1/admin/einvoice/d1/xml').set('Authorization', `Bearer ${token()}`)
    expect(xml.status).toBe(200)
    expect(xml.headers['content-type']).toContain('application/xml')
    expect(xml.headers['content-disposition']).toBe('attachment; filename="fv0900373115000260000001.xml"')
    expect(xml.text).toBe('<Invoice/>')

    Einvoice.getDocumentPdf.mockResolvedValue({ pdf: Buffer.from('%PDF-1.3'), fileName: 'SETP990000001.pdf' })
    const pdf = await request(app).get('/api/v1/admin/einvoice/d1/pdf').set('Authorization', `Bearer ${token()}`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toBe('application/pdf')
  })
})

describe('cliente — PDF de su factura', () => {
  it('GET /orders/:id/invoice.pdf entrega el PDF del dueño de la orden', async () => {
    Einvoice.getCustomerInvoicePdf.mockResolvedValue({ pdf: Buffer.from('%PDF-1.3'), fileName: 'SETP990000001.pdf' })
    const res = await request(app).get('/api/v1/orders/o1/invoice.pdf').set('Authorization', `Bearer ${token('CUSTOMER', 'u1')}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toBe('attachment; filename="SETP990000001.pdf"')
    expect(Einvoice.getCustomerInvoicePdf).toHaveBeenCalledWith('u1', 'o1')
  })

  it('404 si la factura no está disponible o la orden no es suya', async () => {
    Einvoice.getCustomerInvoicePdf.mockRejectedValue(Object.assign(new Error('Orden no encontrada'), { status: 404 }))
    const res = await request(app).get('/api/v1/orders/o2/invoice.pdf').set('Authorization', `Bearer ${token('CUSTOMER', 'u1')}`)
    expect(res.status).toBe(404)
  })

  it('requiere sesión', async () => {
    const res = await request(app).get('/api/v1/orders/o1/invoice.pdf')
    expect(res.status).toBe(401)
  })
})

describe('cambio de estado desde el admin', () => {
  const put = (status) =>
    request(app).put('/api/v1/admin/orders/o1/status').set('Authorization', `Bearer ${token()}`).send({ status })

  it('confirmar (pago manual) dispara la factura', async () => {
    AdminOrdersService.updateOrderStatus.mockResolvedValue({ id: 'o1', status: 'CONFIRMED' })
    expect((await put('CONFIRMED')).status).toBe(200)
    expect(Einvoice.triggerInvoice).toHaveBeenCalledWith('o1')
    expect(Einvoice.triggerCreditNote).not.toHaveBeenCalled()
  })

  it('cancelar o reembolsar dispara la nota crédito', async () => {
    AdminOrdersService.updateOrderStatus.mockResolvedValue({ id: 'o1', status: 'CANCELLED' })
    await put('CANCELLED')
    expect(Einvoice.triggerCreditNote).toHaveBeenCalledWith('o1', 'Pedido cancelado')
    AdminOrdersService.updateOrderStatus.mockResolvedValue({ id: 'o1', status: 'REFUNDED' })
    await put('REFUNDED')
    expect(Einvoice.triggerCreditNote).toHaveBeenCalledWith('o1', 'Devolución del pedido (reembolso)')
  })

  it('enviar no dispara documentos electrónicos', async () => {
    AdminOrdersService.updateOrderStatus.mockResolvedValue({ id: 'o1', status: 'SHIPPED' })
    await put('SHIPPED')
    expect(Einvoice.triggerInvoice).not.toHaveBeenCalled()
    expect(Einvoice.triggerCreditNote).not.toHaveBeenCalled()
  })
})

describe('CORS de descargas', () => {
  it('expone Content-Disposition al frontend', async () => {
    Einvoice.getDocumentPdf.mockResolvedValue({ pdf: Buffer.from('%PDF-1.3'), fileName: 'SETP990000001.pdf' })
    const res = await request(app).get('/api/v1/admin/einvoice/d1/pdf')
      .set('Origin', 'http://localhost:4321')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.headers['access-control-expose-headers']).toBe('Content-Disposition')
  })
})
