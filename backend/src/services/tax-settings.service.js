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
    // Serializa cambios concurrentes de tasa.
    await tx.$queryRaw`SELECT 1 FROM "tax_settings" WHERE "id" = 1 FOR UPDATE`
    const oldRate = await getCurrentRate(tx)
    if (oldRate === rate) return { rate, changed: false, productsUpdated: 0 }

    // Un producto con tasa propia igual a la nueva se mezclaría de forma irreversible con los generales.
    const clash = await tx.$queryRaw`
      SELECT 1 FROM "products" WHERE "taxRate" = ${rate}::numeric AND "taxRate" <> ${oldRate}::numeric LIMIT 1`
    if (clash.length > 0) {
      throw httpError(409, 'No se puede usar esa tasa como IVA general: hay productos con una tasa propia de ese valor (por ejemplo, exentos). Cámbiales la tasa primero.')
    }

    const bp = Math.round(rate * 100)

    // Variantes primero: dependen de la tasa ANTERIOR del producto.
    await tx.$executeRaw`
      UPDATE "product_variants" v
      SET "price" = ROUND(v."basePrice" * (10000 + ${bp}::int) / 10000)
      FROM "products" p
      WHERE v."productId" = p."id" AND v."basePrice" IS NOT NULL AND p."taxRate" = ${oldRate}::numeric`

    const updatedCount = await tx.$executeRaw`
      UPDATE "products"
      SET "taxRate" = ${rate}::numeric, "price" = ROUND("basePrice" * (10000 + ${bp}::int) / 10000)
      WHERE "taxRate" = ${oldRate}::numeric`

    await tx.taxSetting.upsert({
      where: { id: 1 },
      update: { rate, updatedById: userId ?? null, pendingRate: null },
      create: { id: 1, rate, updatedById: userId ?? null },
    })

    const productsUpdated = Number(updatedCount)
    log.info({ userId, oldRate, newRate: rate, productsUpdated }, 'tax.rate_changed')
    return { rate, changed: true, productsUpdated }
  })
}

/** Aplica la tasa detectada por el job de revisión (acción manual del SUPER_ADMIN). */
export const applyPendingRate = async (userId) => {
  const { rate, pendingRate } = await getTaxSetting()
  if (pendingRate === null) throw httpError(409, 'No hay una tasa pendiente por aplicar')
  if (pendingRate === rate) {
    await prisma.taxSetting.update({ where: { id: 1 }, data: { pendingRate: null } })
    return { rate, changed: false, productsUpdated: 0 }
  }
  return setRate(pendingRate, userId)
}
