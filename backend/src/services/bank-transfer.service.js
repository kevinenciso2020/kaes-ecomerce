import cloudinary from '../config/cloudinary.js'
import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'
import { getTransferAccounts, getTransferHolder } from '../config/bank-transfer.js'
import { verifyMagicNumbers, cleanupTempFiles } from '../middleware/upload.middleware.js'
import { processPaymentUpdate, PAY } from './payment.service.js'
import { sendTransferProofAlert, sendTransferRejected } from './email.service.js'

const log = logger.child({ component: 'bank-transfer' })

export const PROOF_FOLDER = 'ecommerce-ropa/payment-proofs'

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code })

/** Referencia corta que el cliente escribe en la descripción de la transferencia. */
export const transferReference = (orderId) => `KAES-${String(orderId).slice(-8).toUpperCase()}`

/** id de pago estable por comprobante: aprobar dos veces el mismo es idempotente. */
const proofPaymentId = (publicId) => `proof:${publicId}`

/**
 * URL firmada para ver el comprobante. Los comprobantes se suben como
 * "authenticated": sin firma Cloudinary no los entrega.
 */
export const proofUrl = (publicId) =>
  publicId
    ? cloudinary.url(publicId, { type: 'authenticated', sign_url: true, secure: true, resource_type: 'image' })
    : null

/** Lo que ve el cliente en /checkout/transferencia. */
export const getTransferInfo = (order) => ({
  orderId: order.id,
  total: Number(order.total),
  reference: transferReference(order.id),
  holder: getTransferHolder(),
  accounts: getTransferAccounts(),
  proofUploadedAt: order.paymentProofAt || null,
  reviewedAt: order.transferReviewedAt || null,
  paymentStatus: order.payment?.provider === 'BANK_TRANSFER' ? order.payment.status : null,
})

export const startTransfer = async (order) => {
  if (order.paymentProvider !== 'BANK_TRANSFER') {
    await prisma.order.update({ where: { id: order.id }, data: { paymentProvider: 'BANK_TRANSFER' } })
  }
  return getTransferInfo(order)
}

/**
 * Sube el comprobante y deja el pago PENDING. Con un pago PENDING el job de
 * expiración le da 3 días a la orden (en vez de ORDER_EXPIRY_MINUTES) para
 * que un admin alcance a revisarlo.
 */
export const uploadProof = async (order, file) => {
  if (!file) throw httpError(400, 'Adjunta la imagen del comprobante (JPG, PNG o WEBP)')

  let uploaded
  try {
    await verifyMagicNumbers([file])
    uploaded = await cloudinary.uploader.upload(file.path, {
      folder: PROOF_FOLDER,
      type: 'authenticated',
      resource_type: 'image',
      transformation: [{ width: 2000, height: 2000, crop: 'limit' }],
    })
  } finally {
    await cleanupTempFiles([file])
  }

  const now = new Date()
  await prisma.order.update({
    where: { id: order.id },
    data: { paymentProvider: 'BANK_TRANSFER', paymentProofPublicId: uploaded.public_id, paymentProofAt: now },
  })

  await processPaymentUpdate({
    provider: 'BANK_TRANSFER',
    orderId: order.id,
    providerPaymentId: proofPaymentId(uploaded.public_id),
    status: PAY.PENDING,
    amount: Number(order.total),
    payload: { publicId: uploaded.public_id, uploadedAt: now.toISOString() },
    source: 'transfer_proof',
  })

  log.info({ orderId: order.id, publicId: uploaded.public_id }, 'transfer.proof_uploaded')
  sendTransferProofAlert({ orderId: order.id, total: order.total, reference: transferReference(order.id) })
    .catch((err) => log.error({ err, orderId: order.id }, 'transfer.proof_alert_failed'))

  return getTransferInfo({ ...order, paymentProofAt: now, payment: { provider: 'BANK_TRANSFER', status: 'PENDING' } })
}

/**
 * Un admin revisa el comprobante.
 *  - Aprobar: se procesa como un pago aprobado (descuenta stock, confirma la
 *    orden, consume cupón, envía email y factura). Idempotente.
 *  - Rechazar: el pago queda FAILED y el cliente puede subir otro comprobante;
 *    la orden tiene ORDER_EXPIRY_MINUTES desde el rechazo antes de expirar.
 */
export const reviewTransfer = async (orderId, { approve, note, changedById } = {}) => {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } })
  if (!order) throw httpError(404, 'Orden no encontrada')
  if (order.paymentProvider !== 'BANK_TRANSFER' || !order.paymentProofPublicId) {
    throw httpError(409, 'Esta orden no tiene un comprobante de transferencia para revisar', 'NO_TRANSFER_PROOF')
  }
  if (!approve && (order.stockDeducted || order.payment?.status === 'COMPLETED')) {
    throw httpError(409, 'El pago ya fue aprobado. Para revertirlo cancela o reembolsa la orden.', 'TRANSFER_ALREADY_APPROVED')
  }

  const providerPaymentId = proofPaymentId(order.paymentProofPublicId)
  const result = await processPaymentUpdate({
    provider: 'BANK_TRANSFER',
    orderId,
    providerPaymentId,
    status: approve ? PAY.APPROVED : PAY.DECLINED,
    amount: Number(order.total),
    payload: { reviewedBy: changedById || null, note: note || null },
    source: 'admin',
  })

  await prisma.order.update({ where: { id: orderId }, data: { transferReviewedAt: new Date() } })

  if (approve) {
    // Deja constancia de qué admin aprobó en el log de la confirmación.
    if (changedById) {
      await prisma.orderStatusLog.updateMany({
        where: { orderId, toStatus: 'CONFIRMED', changedById: null, note: { contains: providerPaymentId } },
        data: { changedById },
      })
    }
  } else if (!result.duplicate) {
    const fresh = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } })
    await prisma.orderStatusLog.create({
      data: {
        orderId,
        fromStatus: fresh.status,
        toStatus: fresh.status,
        changedById: changedById || null,
        note: `Comprobante de transferencia rechazado${note ? `: ${note}` : ''}`,
      },
    })
    sendTransferRejected({ orderId, note })
      .catch((err) => log.error({ err, orderId }, 'transfer.rejected_email_failed'))
  }

  log.info({ orderId, approve: Boolean(approve), outcome: result.outcome, changedById }, 'transfer.reviewed')
  return result
}
