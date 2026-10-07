import { logger } from '../config/logger.js'

const log = logger.child({ component: 'stock' })

// El stock se descuenta SOLO cuando un pago es aprobado (ver payment.service.js)
// y siempre dentro de la transacción que confirma la orden. Estas funciones
// reciben el cliente de transacción `tx` para que todo (orden + stock + pago)
// sea atómico.
//
// Concurrencia: el decremento es un UPDATE condicional
//   UPDATE ... SET stock = stock - q WHERE id = ? AND stock >= q
// En PostgreSQL (READ COMMITTED) dos transacciones que compiten por la última
// unidad se serializan sobre el lock de fila y la segunda re-evalúa el WHERE:
// sólo una afecta 1 fila, la otra afecta 0 y lanza INSUFFICIENT_STOCK.
// Además la BD tiene CHECK (stock >= 0) como última defensa.

export const insufficientStockError = (details, message = 'Stock insuficiente') =>
  Object.assign(new Error(message), { status: 409, code: 'INSUFFICIENT_STOCK', details })

/**
 * Dónde vive el stock de un ítem de orden: en la variante (si la orden la
 * tiene resuelta o si existe una variante con esa talla/color) o en el producto.
 */
export const resolveStockTarget = async (db, item) => {
  if (item.variantId) return { type: 'variant', id: item.variantId }

  if (item.size || item.color) {
    const variant = await db.productVariant.findFirst({
      where: { productId: item.productId, size: item.size ?? null, color: item.color ?? null },
      select: { id: true },
    })
    if (variant) return { type: 'variant', id: variant.id }
  }

  return { type: 'product', id: item.productId }
}

const modelFor = (db, target) => (target.type === 'variant' ? db.productVariant : db.product)

/**
 * Intenta descontar el stock de todos los ítems dentro de `tx`.
 * Devuelve { ok: true } o { ok: false, shortages }.
 *
 * No lanza excepción cuando falta stock: revierte los decrementos que sí
 * aplicó (los locks de fila siguen siendo de esta transacción, así que la
 * reversión es exacta). Así el llamador puede dejar registrado el pago y
 * marcar la orden para revisión sin abortar toda la transacción.
 */
export const tryDeductStockForItems = async (tx, items) => {
  const applied = []
  const shortages = []

  for (const item of items) {
    const target = await resolveStockTarget(tx, item)
    const { count } = await modelFor(tx, target).updateMany({
      where: { id: target.id, stock: { gte: item.quantity } },
      data:  { stock: { decrement: item.quantity } },
    })
    if (count === 1) {
      applied.push({ target, quantity: item.quantity })
    } else {
      shortages.push({
        productId: item.productId,
        variantId: target.type === 'variant' ? target.id : null,
        size:      item.size ?? null,
        color:     item.color ?? null,
        requested: item.quantity,
      })
    }
  }

  if (shortages.length > 0) {
    for (const { target, quantity } of applied) {
      await modelFor(tx, target).update({
        where: { id: target.id },
        data:  { stock: { increment: quantity } },
      })
    }
    log.warn({ shortages }, 'stock.insufficient_on_payment')
    return { ok: false, shortages }
  }

  log.info({ itemCount: items.length }, 'stock.decremented')
  return { ok: true, shortages: [] }
}

/**
 * Devuelve al inventario el stock de los ítems. Sólo debe llamarse para
 * órdenes con `stockDeducted = true`.
 */
export const restoreStockForItems = async (tx, items) => {
  for (const item of items) {
    const target = await resolveStockTarget(tx, item)
    await modelFor(tx, target).update({
      where: { id: target.id },
      data:  { stock: { increment: item.quantity } },
    })
  }
  log.info({ itemCount: items.length }, 'stock.restored')
}
