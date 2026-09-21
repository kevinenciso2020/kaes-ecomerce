import crypto from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'
import { captureError } from '../config/sentry.js'
import { tryDeductStockForItems } from './stock.service.js'
import { consumeCoupon } from './coupon.service.js'
import { sendOrderConfirmation } from './email.service.js'

const log = logger.child({ component: 'payments' })

// Estados normalizados de un pago, independientes del proveedor.
export const PAY = {
  APPROVED: 'APPROVED',
  PENDING:  'PENDING',
  DECLINED: 'DECLINED',
  VOIDED:   'VOIDED',   // anulado / reembolsado / contracargo
  ERROR:    'ERROR',
}

export const mapWompiStatus = (status) => {
  switch (status) {
    case 'APPROVED': return PAY.APPROVED
    case 'DECLINED': return PAY.DECLINED
    case 'VOIDED':   return PAY.VOIDED
    case 'ERROR':    return PAY.ERROR
    default:         return PAY.PENDING
  }
}

export const mapMercadoPagoStatus = (status) => {
  switch (status) {
    case 'approved':     return PAY.APPROVED
    case 'rejected':     return PAY.DECLINED
    case 'cancelled':    return PAY.VOIDED
    case 'refunded':
    case 'charged_back': return PAY.VOIDED
    default:             return PAY.PENDING // pending, in_process, authorized, in_mediation
  }
}

const PAYMENT_ROW_STATUS = {
  [PAY.APPROVED]: 'COMPLETED',
  [PAY.PENDING]:  'PENDING',
  [PAY.DECLINED]: 'FAILED',
  [PAY.ERROR]:    'FAILED',
  [PAY.VOIDED]:   'REFUNDED',
}

// Tolerancia de redondeo al comparar montos (COP no usa centavos en la práctica).
const AMOUNT_TOLERANCE = 1

const sameAmount = (a, b) => Math.abs(Number(a) - Number(b)) <= AMOUNT_TOLERANCE

/**
 * Inserta el evento si no existe. Usa ON CONFLICT DO NOTHING para no abortar
 * la transacción ante duplicados (en PostgreSQL un error dentro de una
 * transacción la invalida completa).
 */
const insertEventOnce = async (tx, { provider, eventKey, orderId, providerPaymentId, status, amount, payload }) => {
  const rows = await tx.$queryRaw`
    INSERT INTO "payment_events" ("id", "provider", "eventKey", "orderId", "providerPaymentId", "status", "amount", "payload")
    VALUES (${crypto.randomUUID()}, ${provider}::"PaymentProvider", ${eventKey}, ${orderId}, ${providerPaymentId},
            ${status}, ${amount}, ${JSON.stringify(payload ?? null)}::jsonb)
    ON CONFLICT ("eventKey") DO NOTHING
    RETURNING "id"
  `
  return rows[0]?.id ?? null
}

const upsertPaymentRow = async (tx, { order, provider, providerPaymentId, status, amount, currency }) => {
  const existing = await tx.payment.findUnique({ where: { orderId: order.id } })
  const rowStatus = PAYMENT_ROW_STATUS[status]

  // Un pago ya COMPLETED sólo puede pasar a REFUNDED (anulación/reembolso).
  // Notificaciones tardías de "pending"/"rejected" no lo degradan.
  if (existing?.status === 'COMPLETED' && rowStatus !== 'REFUNDED') {
    if (existing.providerPaymentId === providerPaymentId || status !== PAY.APPROVED) return existing
  }

  const data = {
    provider,
    providerPaymentId,
    status: rowStatus,
    amount: amount ?? Number(order.total),
    currency: currency || 'COP',
  }
  return existing
    ? tx.payment.update({ where: { orderId: order.id }, data })
    : tx.payment.create({ data: { orderId: order.id, ...data } })
}

const flagForReview = async (tx, order, note) => {
  await tx.order.update({
    where: { id: order.id },
    data: { needsReview: true, reviewNote: note },
  })
}

/**
 * Procesa una actualización de pago de cualquier proveedor. Es IDEMPOTENTE:
 * el mismo (proveedor, id de pago, estado) se procesa una sola vez gracias al
 * índice único de payment_events.eventKey.
 *
 * Todo ocurre en una transacción con la orden bloqueada (SELECT … FOR UPDATE):
 * confirmar la orden, descontar stock, consumir el cupón, registrar el pago y
 * vaciar el carrito son una sola unidad atómica.
 *
 * Devuelve { outcome, duplicate, orderId, orderStatus }.
 */
export const processPaymentUpdate = async ({
  provider,            // 'WOMPI' | 'MERCADOPAGO'
  orderId,
  providerPaymentId,
  status,              // PAY.*
  amount,              // monto pagado en COP
  currency = 'COP',
  payload,
  source = 'webhook',  // 'webhook' | 'verify'
}) => {
  const eventKey = `${provider}:${providerPaymentId}:${status}`
  const ctx = { provider, orderId, providerPaymentId, status, amount, source }

  const result = await prisma.$transaction(async (tx) => {
    const eventId = await insertEventOnce(tx, {
      provider, eventKey, orderId, providerPaymentId: String(providerPaymentId), status,
      amount: amount ?? null, payload,
    })
    if (!eventId) return { outcome: 'DUPLICATE', duplicate: true }

    const locked = orderId
      ? await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE`
      : []
    if (locked.length === 0) {
      await tx.paymentEvent.update({ where: { id: eventId }, data: { outcome: 'ORDER_NOT_FOUND' } })
      return { outcome: 'ORDER_NOT_FOUND' }
    }

    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })
    let outcome
    let newlyConfirmed = false
    let reviewNote = null

    if (status === PAY.APPROVED) {
      if (order.stockDeducted) {
        const current = await tx.payment.findUnique({ where: { orderId } })
        if (current && current.providerPaymentId && current.providerPaymentId !== String(providerPaymentId)) {
          reviewNote = `Pago duplicado: la orden ya estaba pagada (${current.provider} ${current.providerPaymentId}) y llegó otro pago aprobado (${provider} ${providerPaymentId}). Reembolsar uno.`
          await flagForReview(tx, order, reviewNote)
          outcome = 'DUPLICATE_PAYMENT'
        } else {
          outcome = 'ALREADY_PAID'
        }
      } else if (amount != null && !sameAmount(amount, order.total)) {
        reviewNote = `Monto pagado (${amount}) distinto al total de la orden (${order.total}). No se confirmó.`
        await flagForReview(tx, order, reviewNote)
        await upsertPaymentRow(tx, { order, provider, providerPaymentId: String(providerPaymentId), status, amount, currency })
        outcome = 'AMOUNT_MISMATCH'
      } else {
        const stock = await tryDeductStockForItems(tx, order.items)
        await upsertPaymentRow(tx, { order, provider, providerPaymentId: String(providerPaymentId), status, amount, currency })

        if (!stock.ok) {
          reviewNote = 'Pago aprobado pero sin stock suficiente. Contactar al cliente y reembolsar o reponer.'
          await flagForReview(tx, order, reviewNote)
          outcome = 'OUT_OF_STOCK'
        } else {
          const wasCancelled = order.status === 'CANCELLED'
          if (wasCancelled) {
            reviewNote = 'Pago recibido sobre una orden cancelada/expirada. Se confirmó porque había stock; verificar.'
          }
          await tx.order.update({
            where: { id: orderId },
            data: {
              status: 'CONFIRMED',
              paidAt: new Date(),
              stockDeducted: true,
              paymentProvider: provider,
              ...(wasCancelled ? { needsReview: true, reviewNote } : {}),
            },
          })
          await tx.orderStatusLog.create({
            data: {
              orderId,
              fromStatus: order.status,
              toStatus: 'CONFIRMED',
              note: `Pago aprobado (${provider} ${providerPaymentId}) vía ${source}`,
            },
          })
          if (order.couponCode) await consumeCoupon(tx, order.couponCode)
          await tx.cartItem.deleteMany({ where: { userId: order.userId } })
          newlyConfirmed = true
          outcome = 'CONFIRMED'
        }
      }
    } else if (status === PAY.VOIDED && order.stockDeducted) {
      reviewNote = `El pago ${providerPaymentId} fue anulado/reembolsado después de aprobado. Revisar si se debe cancelar el envío.`
      await flagForReview(tx, order, reviewNote)
      await upsertPaymentRow(tx, { order, provider, providerPaymentId: String(providerPaymentId), status, amount, currency })
      outcome = 'VOIDED_AFTER_PAYMENT'
    } else if (order.stockDeducted) {
      // Rechazos o "pending" de otro intento sobre una orden ya pagada: se ignoran.
      outcome = 'IGNORED_ORDER_PAID'
    } else {
      // Pendiente o rechazado: la orden sigue PENDING para que el cliente
      // pueda reintentar. El job de expiración la cancela si nadie paga.
      await upsertPaymentRow(tx, { order, provider, providerPaymentId: String(providerPaymentId), status, amount, currency })
      if (!order.paymentProvider || order.paymentProvider !== provider) {
        await tx.order.update({ where: { id: orderId }, data: { paymentProvider: provider } })
      }
      outcome = status === PAY.PENDING ? 'PENDING' : 'DECLINED'
    }

    await tx.paymentEvent.update({ where: { id: eventId }, data: { outcome } })
    const fresh = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } })
    return { outcome, newlyConfirmed, reviewNote, orderStatus: fresh.status }
  }, { timeout: 20_000, maxWait: 10_000 })

  if (result.duplicate) {
    log.info(ctx, 'payment.event_duplicate')
    return { ...result, orderId }
  }

  log.info({ ...ctx, outcome: result.outcome, orderStatus: result.orderStatus }, 'payment.processed')

  if (result.reviewNote) {
    log.error({ ...ctx, outcome: result.outcome, reviewNote: result.reviewNote }, 'payment.needs_review')
    captureError(new Error(`Pago requiere revisión: ${result.outcome}`), { ...ctx, reviewNote: result.reviewNote })
  }

  if (result.newlyConfirmed) {
    sendOrderConfirmation(orderId).catch((err) =>
      log.error({ err, orderId }, 'payment.confirmation_email_failed'),
    )
  }

  return { ...result, duplicate: false, orderId }
}

/**
 * Cancela órdenes PENDING sin pago después de ORDER_EXPIRY_MINUTES (default 120).
 * El stock no se reservó, así que no hay nada que devolver. Si luego llega un
 * pago aprobado, processPaymentUpdate la reactiva (si hay stock) y la marca
 * para revisión.
 */
export const expireStaleOrders = async ({ now = new Date() } = {}) => {
  const minutes = Number.parseInt(process.env.ORDER_EXPIRY_MINUTES || '120', 10)
  const cutoff = new Date(now.getTime() - minutes * 60 * 1000)

  const stale = await prisma.order.findMany({
    where: {
      status: 'PENDING',
      stockDeducted: false,
      needsReview: false,
      createdAt: { lt: cutoff },
      OR: [{ payment: { is: null } }, { payment: { status: { in: ['FAILED', 'PENDING'] } } }],
    },
    select: { id: true, payment: { select: { status: true } } },
    take: 200,
  })

  // Un pago PENDING (p. ej. PSE/efectivo en proceso) tiene más margen: 3 días.
  const pendingCutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
  const ids = []
  for (const o of stale) {
    if (o.payment?.status === 'PENDING') {
      const full = await prisma.order.findUnique({ where: { id: o.id }, select: { createdAt: true } })
      if (full.createdAt >= pendingCutoff) continue
    }
    ids.push(o.id)
  }
  if (ids.length === 0) return 0

  const { count } = await prisma.order.updateMany({
    where: { id: { in: ids }, status: 'PENDING', stockDeducted: false },
    data: { status: 'CANCELLED' },
  })
  await prisma.orderStatusLog.createMany({
    data: ids.map((orderId) => ({
      orderId, fromStatus: 'PENDING', toStatus: 'CANCELLED', note: `Expirada sin pago tras ${minutes} min`,
    })),
  })
  log.info({ count }, 'orders.expired')
  return count
}
