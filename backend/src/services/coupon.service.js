import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'

const log = logger.child({ component: 'coupon' })

const roundMoney = (n) => Math.round(n * 100) / 100

// Un cupón está vigente si está activo y "ahora" cae dentro de su ventana.
// startsAt/endsAt en NULL significan "sin límite" en ese extremo.
const activeWindowWhere = (now) => ({
  isActive: true,
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
})

export const normalizeCouponCode = (code) =>
  typeof code === 'string' ? code.trim().toUpperCase() : ''

export const computeCouponDiscount = (coupon, subtotal) => {
  const raw = coupon.type === 'PERCENTAGE'
    ? subtotal * (parseFloat(coupon.value) / 100)
    : parseFloat(coupon.value)
  return roundMoney(Math.max(0, Math.min(raw, subtotal)))
}

/**
 * Valida un cupón contra un subtotal. Nunca lanza por reglas de negocio:
 * devuelve { valid: false, error } para que el llamador decida.
 */
export const validateCoupon = async (code, subtotal = 0, db = prisma) => {
  const normalized = normalizeCouponCode(code)
  if (!normalized) {
    return { valid: false, error: 'Código de cupón requerido' }
  }

  const coupon = await db.coupon.findFirst({
    where: { code: normalized, ...activeWindowWhere(new Date()) },
  })

  if (!coupon) {
    return { valid: false, error: 'Cupón no válido o expirado', message: 'El código de cupón no existe o ha expirado' }
  }

  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, error: 'Cupón alcanzado en límite de usos', message: 'Este cupón ya alcanzó su límite de usos' }
  }

  if (coupon.minPurchase && subtotal < parseFloat(coupon.minPurchase)) {
    const min = Number(coupon.minPurchase).toLocaleString('es-CO')
    return {
      valid: false,
      error: `Compra mínima de $${min} para aplicar este cupón`,
      message: `Compra mínima de $${min} para usar este cupón`,
    }
  }

  return {
    valid: true,
    coupon: {
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount: computeCouponDiscount(coupon, subtotal),
    },
  }
}

/**
 * Registra un uso del cupón. Se llama cuando el pago es APROBADO (no al crear
 * la orden), dentro de la transacción de confirmación. El UPDATE es
 * condicional para no pasar de maxUses bajo concurrencia.
 */
export const consumeCoupon = async (tx, code) => {
  const normalized = normalizeCouponCode(code)
  if (!normalized) return false
  const affected = await tx.$executeRaw`
    UPDATE "coupons"
       SET "usedCount" = "usedCount" + 1
     WHERE "code" = ${normalized}
       AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
  `
  if (affected !== 1) {
    // El cliente ya pagó con el descuento: se respeta, pero queda registro.
    log.warn({ code: normalized }, 'coupon.consume_over_limit')
    return false
  }
  return true
}
