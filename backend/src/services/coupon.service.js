import { prisma } from '../config/prisma.js'

export const validateCoupon = async (code, subtotal = 0) => {
  const now = new Date()
  const coupon = await prisma.coupon.findFirst({
    where: {
      code: code.toUpperCase(),
      isActive: true,
      startsAt: { lte: now },
      AND: [
        {
          OR: [
            { endsAt: { gte: now } },
            { endsAt: null },
          ],
        },
      ],
    },
  })

  if (!coupon) {
    return { valid: false, error: 'Cupón no válido o expirado', message: 'El código de cupón no existe o ha expirado' }
  }

  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, error: 'Cupón alcanzado en límite de usos', message: 'Este cupón ya alcanzó su límite de usos' }
  }

  if (coupon.minPurchase && subtotal < parseFloat(coupon.minPurchase)) {
    return {
      valid: false,
      error: ` mínimo de $${Number(coupon.minPurchase).toLocaleString('es-CO')} para aplicar este cupón`,
      message: `Compra mínima de $${Number(coupon.minPurchase).toLocaleString('es-CO')} para usar este cupón`,
    }
  }

  const discount =
    coupon.type === 'PERCENTAGE'
      ? subtotal * (parseFloat(coupon.value) / 100)
      : parseFloat(coupon.value)

  return {
    valid: true,
    coupon: {
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount: Math.min(discount, subtotal),
    },
  }
}