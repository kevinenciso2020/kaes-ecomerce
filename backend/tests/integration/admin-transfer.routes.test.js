import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

// Revisión de comprobantes de transferencia desde el admin. La parte
// transaccional (stock, idempotencia) está en tests/db/payments.db.test.js.

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findFirst: vi.fn() },
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderStatusLog: { create: vi.fn(), updateMany: vi.fn() },
  },
  processPaymentUpdate: vi.fn(),
  sendTransferRejected: vi.fn(),
}))

vi.mock('../../src/config/prisma.js', () => ({ prisma: mocks.prisma }))

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

vi.mock('../../src/services/payment.service.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, processPaymentUpdate: mocks.processPaymentUpdate }
})

vi.mock('../../src/services/email.service.js', () => ({
  sendOrderCancelled: vi.fn().mockResolvedValue(true),
  sendTransferProofAlert: vi.fn().mockResolvedValue(true),
  sendTransferRejected: mocks.sendTransferRejected,
}))

import request from 'supertest'
import app from '../../src/app.js'

const tokenFor = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' })
const adminToken = () => tokenFor({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' })
const customerToken = () => tokenFor({ id: 'u1', email: 'c@d.com', role: 'CUSTOMER', emailVerified: true })

const transferOrder = (overrides = {}) => ({
  id: 'o1', userId: 'u1', status: 'PENDING', total: '100000', stockDeducted: false,
  paymentProvider: 'BANK_TRANSFER', paymentProofPublicId: 'ecommerce-ropa/payment-proofs/abc',
  payment: { provider: 'BANK_TRANSFER', status: 'PENDING' },
  items: [], statusLogs: [],
  ...overrides,
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.prisma.user.findFirst.mockResolvedValue({ id: 'a1' })
  mocks.prisma.order.update.mockResolvedValue({})
  mocks.prisma.orderStatusLog.create.mockResolvedValue({})
  mocks.prisma.orderStatusLog.updateMany.mockResolvedValue({ count: 1 })
  mocks.sendTransferRejected.mockResolvedValue(true)
})

const review = (body, token = adminToken()) =>
  request(app).post('/api/v1/admin/orders/o1/transfer/review').set('Authorization', `Bearer ${token}`).send(body)

describe('POST /api/v1/admin/orders/:id/transfer/review', () => {
  it('aprobar procesa un pago APPROVED por el total y registra al admin', async () => {
    mocks.prisma.order.findUnique
      .mockResolvedValueOnce(transferOrder())                                  // reviewTransfer
      .mockResolvedValueOnce(transferOrder({ status: 'CONFIRMED' }))           // getOrderById
    mocks.processPaymentUpdate.mockResolvedValueOnce({ outcome: 'CONFIRMED', duplicate: false })

    const res = await review({ approve: true })

    expect(res.status).toBe(200)
    expect(res.body.outcome).toBe('CONFIRMED')
    expect(res.body.order.paymentProofUrl).toContain('/image/authenticated/')
    expect(mocks.processPaymentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'BANK_TRANSFER', orderId: 'o1', status: 'APPROVED', amount: 100000,
      providerPaymentId: 'proof:ecommerce-ropa/payment-proofs/abc', source: 'admin',
    }))
    expect(mocks.prisma.orderStatusLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { changedById: 'a1' } }))
    expect(mocks.sendTransferRejected).not.toHaveBeenCalled()
  })

  it('rechazar marca el pago DECLINED, deja nota y avisa al cliente', async () => {
    mocks.prisma.order.findUnique
      .mockResolvedValueOnce(transferOrder())
      .mockResolvedValueOnce({ status: 'PENDING' })
      .mockResolvedValueOnce(transferOrder())
    mocks.processPaymentUpdate.mockResolvedValueOnce({ outcome: 'DECLINED', duplicate: false })

    const res = await review({ approve: false, note: 'El monto no coincide' })

    expect(res.status).toBe(200)
    expect(mocks.processPaymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'DECLINED' }))
    expect(mocks.prisma.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { transferReviewedAt: expect.any(Date) } })
    expect(mocks.prisma.orderStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: 'Comprobante de transferencia rechazado: El monto no coincide', changedById: 'a1' }),
    })
    expect(mocks.sendTransferRejected).toHaveBeenCalledWith({ orderId: 'o1', note: 'El monto no coincide' })
  })

  it('409 si la orden no tiene comprobante', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(transferOrder({ paymentProofPublicId: null }))
    const res = await review({ approve: true })
    expect(res.status).toBe(409)
    expect(mocks.processPaymentUpdate).not.toHaveBeenCalled()
  })

  it('409 al rechazar un pago ya aprobado', async () => {
    mocks.prisma.order.findUnique.mockResolvedValueOnce(transferOrder({ stockDeducted: true, payment: { status: 'COMPLETED' } }))
    const res = await review({ approve: false })
    expect(res.status).toBe(409)
  })

  it('400 si approve no es booleano', async () => {
    const res = await review({ approve: 'si' })
    expect(res.status).toBe(400)
  })

  it('403 para clientes', async () => {
    const res = await review({ approve: true }, customerToken())
    expect(res.status).toBe(403)
    expect(mocks.processPaymentUpdate).not.toHaveBeenCalled()
  })
})
