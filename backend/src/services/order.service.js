import { prisma } from '../config/prisma.js'
import { buildQuote } from './pricing.service.js'

export const PRIVACY_POLICY_VERSION = process.env.PRIVACY_POLICY_VERSION || '2026-09-21'

const badRequest = (message, extra = {}) =>
  Object.assign(new Error(message), { status: 400, ...extra })

/** Resumen del checkout calculado por el servidor (no crea nada). */
export const quoteOrder = async ({ items, couponCode }) =>
  buildQuote({ items, couponCode }, { strictCoupon: false })

export const createOrder = async (userId, { items, couponCode, shippingAddressId, notes, address, acceptTerms }) => {
  if (acceptTerms !== true && acceptTerms !== 'true') {
    throw badRequest('Debes aceptar los términos y la política de tratamiento de datos', { code: 'TERMS_REQUIRED' })
  }

  // Precios, descuentos, cupón, envío y stock calculados SIEMPRE desde la BD.
  const quote = await buildQuote({ items, couponCode }, { strictCoupon: true })

  if (!shippingAddressId && !address) {
    throw badRequest('La dirección de envío es requerida')
  }

  if (shippingAddressId) {
    const owned = await prisma.address.findFirst({ where: { id: shippingAddressId, userId }, select: { id: true } })
    if (!owned) throw badRequest('Dirección de envío no válida')
  }

  const now = new Date()

  return prisma.$transaction(async (tx) => {
    let finalShippingAddressId = shippingAddressId

    if (!finalShippingAddressId) {
      const departamento = (address.departamento || address.department || '').trim()
      const municipio = (address.municipio || address.city || '').trim()
      const newAddress = await tx.address.create({
        data: {
          userId,
          label: address.label || 'Casa',
          street: address.street,
          // city/department se mantienen sincronizados por compatibilidad con
          // pantallas antiguas; la fuente canónica es departamento/municipio.
          city: municipio,
          department: departamento,
          departamento,
          municipio,
          zipCode: address.zipCode || null,
          fullName: address.fullName || null,
          phone: address.phone || null,
        },
      })
      finalShippingAddressId = newAddress.id
    }

    // Registro de la autorización Habeas Data si el usuario aún no la tenía.
    await tx.user.updateMany({
      where: { id: userId, privacyAcceptedAt: null },
      data: { privacyAcceptedAt: now, privacyPolicyVersion: PRIVACY_POLICY_VERSION },
    })

    // El carrito NO se vacía aquí: se vacía cuando el pago es aprobado, así
    // el cliente no pierde su carrito si el pago falla.
    return tx.order.create({
      data: {
        userId,
        subtotal: quote.subtotal,
        discount: quote.discount,
        shipping: quote.shipping,
        total: quote.total,
        couponCode: quote.coupon?.code ?? null,
        shippingAddressId: finalShippingAddressId,
        notes: notes || null,
        termsAcceptedAt: now,
        items: {
          create: quote.items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantity: i.quantity,
            price: i.unitPrice,
            size: i.size,
            color: i.color,
            variantSnapshot: i.variantId
              ? { sku: i.sku, colorHex: i.colorHex, basePrice: i.basePrice }
              : undefined,
          })),
        },
        statusLogs: {
          create: { toStatus: 'PENDING', changedById: userId, note: 'Orden creada' },
        },
      },
      include: { items: { include: { product: true } } },
    })
  })
}

export const getOrders = async (userId) => {
  return prisma.order.findMany({
    where:   { userId },
    include: {
      items:   { include: { product: { include: { images: { where: { isMain: true }, take: 1 } } } } },
      payment: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}

export const getOrderById = async (userId, orderId) => {
  const order = await prisma.order.findFirst({
    where:   { id: orderId, userId },
    include: {
      items:           { include: { product: { include: { images: true } } } },
      payment:         true,
      shippingAddress: true,
    },
  })

  if (!order) {
    const err = new Error('Orden no encontrada')
    err.status = 404
    throw err
  }

  return order
}
