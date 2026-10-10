import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'
import { GENERAL_RATE, isValidRate } from './tax.service.js'

const log = logger.child({ component: 'tax-settings' })

const httpError = (status, message) => Object.assign(new Error(message), { status })
const num = (v) => (v === null || v === undefined ? null : Number(v))

/** Tasa de IVA vigente (19 si todavía no existe la fila). */
export const getCurrentRate = async (db = prisma) => {
  const row = await db.taxSetting.findUnique({ where: { id: 1 } })
  return row ? Number(row.rate) : GENERAL_RATE
}

export const getTaxSetting = async (db = prisma) => {
  const row = await db.taxSetting.findUnique({ where: { id: 1 } })
  return {
    rate: row ? Number(row.rate) : GENERAL_RATE,
    pendingRate: num(row?.pendingRate),
    lastCheckAt: row?.lastCheckAt ?? null,
    lastCheckRate: num(row?.lastCheckRate),
    lastCheckSource: row?.lastCheckSource ?? null,
    updatedAt: row?.updatedAt ?? null,
  }
}

/**
 * Cambia la tasa general y recalcula `price` de los productos (y de sus variantes
 * con precio propio) que seguían la tasa anterior. Los productos con otra tasa
 * (p. ej. exentos, 0 %) no se tocan. Todo en una transacción.
 */
export const setRate = async (rate, userId) => {
  if (!isValidRate(rate)) throw httpError(400, 'La tasa de IVA debe estar entre 0 y 30')

  return prisma.$transaction(async (tx) => {
    const oldRate = await getCurrentRate(tx)
    if (oldRate === rate) return { rate, changed: false, productsUpdated: 0 }

    const bp = Math.round(rate * 100)

    // Variantes primero: dependen de la tasa ANTERIOR del producto.
    await tx.$executeRaw`
      UPDATE "product_variants" v
      SET "price" = ROUND(v."basePrice" * (10000 + ${bp}::int) / 10000)
      FROM "products" p
      WHERE v."productId" = p."id" AND v."basePrice" IS NOT NULL AND p."taxRate" = ${oldRate}::numeric`

    const productsUpdated = await tx.$executeRaw`
      UPDATE "products"
      SET "taxRate" = ${rate}::numeric, "price" = ROUND("basePrice" * (10000 + ${bp}::int) / 10000)
      WHERE "taxRate" = ${oldRate}::numeric`

    await tx.taxSetting.upsert({
      where: { id: 1 },
      update: { rate, updatedById: userId ?? null, pendingRate: null },
      create: { id: 1, rate, updatedById: userId ?? null },
    })

    log.info({ userId, oldRate, newRate: rate, productsUpdated }, 'tax.rate_changed')
    return { rate, changed: true, productsUpdated: Number(productsUpdated) }
  })
}

/** Aplica la tasa detectada por el job de revisión (acción manual del SUPER_ADMIN). */
export const applyPendingRate = async (userId) => {
  const { pendingRate } = await getTaxSetting()
  if (pendingRate === null) throw httpError(409, 'No hay una tasa pendiente por aplicar')
  return setRate(pendingRate, userId)
}
