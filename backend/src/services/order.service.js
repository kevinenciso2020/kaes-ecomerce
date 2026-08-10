import { prisma } from '../config/prisma.js'

export const createOrder = async (userId, { items, couponCode, shippingAddressId, notes, address }) => {
  // Calcular el total verificando precios desde la DB (nunca confiar en el cliente)
  let subtotal = 0
  const orderItems = []

  for (const item of items) {
    const product = await prisma.product.findFirst({ where: { id: item.productId, isActive: true } })
    if (!product) throw Object.assign(new Error(`Producto ${item.productId} no disponible`), { status: 400 })

    const price = parseFloat(product.price)
    subtotal += price * item.quantity
    orderItems.push({ productId: item.productId, quantity: item.quantity, price, size: item.size, color: item.color })
  }

  // Aplicar cupón si existe
  let discount = 0
  if (couponCode) {
    const now = new Date()
    const coupon = await prisma.coupon.findFirst({
      where: {
        code: couponCode.toUpperCase(),
        isActive: true,
        startsAt: { lte: now },
        endsAt: {
          OR: [{ gte: now }, { isNull: true }]
        }
      }
    })
    if (coupon && (!coupon.maxUses || coupon.usedCount < coupon.maxUses)) {
      if (!coupon.minPurchase || subtotal >= parseFloat(coupon.minPurchase)) {
        discount = coupon.type === 'PERCENTAGE'
          ? subtotal * (parseFloat(coupon.value) / 100)
          : parseFloat(coupon.value)
        await prisma.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } })
      }
    }
  }

  const total = Math.max(0, subtotal - discount)

  // Crear la orden y sus items en una sola transacción
  const order = await prisma.$transaction(async (tx) => {
    let finalShippingAddressId = shippingAddressId

    // Si se proporciona dirección, crearla
    if (address && !shippingAddressId) {
      const departamento = (address.departamento || address.department || '').trim()
      const municipio = (address.municipio || address.city || '').trim()
      const newAddress = await tx.address.create({
        data: {
          userId,
          label: address.label || 'Casa',
          street: address.street,
          city: municipio,
          department: departamento,
          departamento,
          municipio,
          zipCode: address.zipCode || null,
          fullName: address.fullName || null,
          phone: address.phone || null,
        }
      })
      finalShippingAddressId = newAddress.id
    }

    const newOrder = await tx.order.create({
      data: {
        userId,
        subtotal,
        discount,
        total,
        couponCode,
        shippingAddressId: finalShippingAddressId,
        notes,
        items: { create: orderItems }
      },
      include: { items: { include: { product: true } } }
    })

    // Vaciar el carrito del usuario después de crear la orden
    await tx.cartItem.deleteMany({ where: { userId } })

    return newOrder
  })

  return order
}

export const getOrders = async (userId) => {
  return prisma.order.findMany({
    where:   { userId },
    include: {
      items:   { include: { product: { include: { images: { where: { isMain: true }, take: 1 } } } } },
      payment: true,
    },
    orderBy: { createdAt: 'desc' }
  })
}

export const getOrderById = async (userId, orderId) => {
  const order = await prisma.order.findFirst({
    where:   { id: orderId, userId },
    include: {
      items:           { include: { product: { include: { images: true } } } },
      payment:         true,
      shippingAddress: true,
    }
  })

  if (!order) {
    const err = new Error('Orden no encontrada')
    err.status = 404
    throw err
  }

  return order
}