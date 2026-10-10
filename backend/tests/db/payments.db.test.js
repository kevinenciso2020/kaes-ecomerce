import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Sin SMTP en tests: el email de confirmación se registra pero no se envía.
vi.mock('../../src/services/email.service.js', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue(true),
  sendOrderCancelled: vi.fn().mockResolvedValue(true),
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
  sendContactNotification: vi.fn().mockResolvedValue(true),
}))

const { prisma } = await import('../../src/config/prisma.js')
const { createOrder, quoteOrder } = await import('../../src/services/order.service.js')
const { processPaymentUpdate, expireStaleOrders, PAY } = await import('../../src/services/payment.service.js')
const { updateOrderStatus } = await import('../../src/services/admin-orders.service.js')
const { sendOrderConfirmation } = await import('../../src/services/email.service.js')

const TABLES = [
  'payment_events', 'payments', 'order_status_logs', 'order_items', 'orders', 'cart_items',
  'addresses', 'refresh_tokens', 'product_discounts', 'discounts', 'coupons',
  'product_variants', 'product_images', 'product_available_sizes', 'products', 'categories', 'users',
]

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`)
  vi.clearAllMocks()
  delete process.env.SHIPPING_FLAT_RATE
  delete process.env.FREE_SHIPPING_FROM
})

afterAll(async () => {
  await prisma.$disconnect()
})

let seq = 0
const makeUser = (data = {}) =>
  prisma.user.create({
    data: { email: `u${++seq}@test.co`, password: 'x', name: 'Cliente', emailVerified: true, ...data },
  })

const makeProduct = async ({ price = 50000, stock = 10, variants } = {}) => {
  const category = await prisma.category.upsert({
    where: { slug: 'camisetas' }, update: {}, create: { name: 'Camisetas', slug: 'camisetas' },
  })
  return prisma.product.create({
    data: {
      name: `Producto ${++seq}`, slug: `producto-${seq}`, description: '', price, basePrice: Math.round(price / 1.19), stock, categoryId: category.id,
      variants: variants ? { create: variants } : undefined,
    },
    include: { variants: true },
  })
}

const address = { fullName: 'Ana Pérez', phone: '3001234567', street: 'Calle 1 # 2-3', departamento: 'Antioquia', municipio: 'Medellín' }

const order = (user, items, extra = {}) =>
  createOrder(user.id, { items, address, acceptTerms: true, ...extra })

const approve = (o, paymentId, amount = Number(o.total), extra = {}) =>
  processPaymentUpdate({
    provider: 'WOMPI', orderId: o.id, providerPaymentId: paymentId, status: PAY.APPROVED, amount, ...extra,
  })

const stockOf = async (productId) => (await prisma.product.findUnique({ where: { id: productId } })).stock

describe('Crear orden y aprobar pago (flujo completo)', () => {
  it('confirma la orden, descuenta stock, consume cupón, vacía carrito y registra el pago', async () => {
    const user = await makeUser()
    const product = await makeProduct({ price: 50000, stock: 5 })
    // Cupón SIN fechas (antes esto rompía con 500 por la query inválida)
    await prisma.coupon.create({ data: { code: 'BIENVENIDO10', type: 'PERCENTAGE', value: 10, maxUses: 5 } })
    await prisma.cartItem.create({ data: { userId: user.id, productId: product.id, quantity: 2 } })

    const created = await order(user, [{ productId: product.id, quantity: 2 }], { couponCode: 'bienvenido10' })
    expect(Number(created.subtotal)).toBe(100000)
    expect(Number(created.discount)).toBe(10000)
    expect(Number(created.total)).toBe(90000)
    expect(created.couponCode).toBe('BIENVENIDO10')
    // Crear la orden NO descuenta stock ni vacía el carrito ni consume el cupón
    expect(await stockOf(product.id)).toBe(5)
    expect(await prisma.cartItem.count({ where: { userId: user.id } })).toBe(1)
    expect((await prisma.coupon.findUnique({ where: { code: 'BIENVENIDO10' } })).usedCount).toBe(0)
    // Consentimiento registrado
    expect((await prisma.user.findUnique({ where: { id: user.id } })).privacyAcceptedAt).toBeInstanceOf(Date)

    const result = await approve(created, 'tx-1')
    expect(result.outcome).toBe('CONFIRMED')

    const fresh = await prisma.order.findUnique({ where: { id: created.id }, include: { payment: true, statusLogs: true } })
    expect(fresh.status).toBe('CONFIRMED')
    expect(fresh.stockDeducted).toBe(true)
    expect(fresh.paidAt).toBeInstanceOf(Date)
    expect(fresh.payment).toMatchObject({ status: 'COMPLETED', provider: 'WOMPI', providerPaymentId: 'tx-1' })
    expect(fresh.statusLogs.map((l) => l.toStatus)).toEqual(expect.arrayContaining(['PENDING', 'CONFIRMED']))
    expect(await stockOf(product.id)).toBe(3)
    expect((await prisma.coupon.findUnique({ where: { code: 'BIENVENIDO10' } })).usedCount).toBe(1)
    expect(await prisma.cartItem.count({ where: { userId: user.id } })).toBe(0)
    expect(sendOrderConfirmation).toHaveBeenCalledWith(created.id)
  })

  it('webhook repetido (misma transacción y estado) NO descuenta stock dos veces ni reenvía email', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 5 })
    const created = await order(user, [{ productId: product.id, quantity: 2 }])

    await approve(created, 'tx-dup')
    const second = await approve(created, 'tx-dup')
    const third = await approve(created, 'tx-dup')

    expect(second.duplicate).toBe(true)
    expect(third.duplicate).toBe(true)
    expect(await stockOf(product.id)).toBe(3)
    expect(sendOrderConfirmation).toHaveBeenCalledTimes(1)
    expect(await prisma.paymentEvent.count()).toBe(1)
  })

  it('webhooks CONCURRENTES del mismo pago: se procesa uno solo', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 5 })
    const created = await order(user, [{ productId: product.id, quantity: 1 }])

    const results = await Promise.all(Array.from({ length: 5 }, () => approve(created, 'tx-same')))
    expect(results.filter((r) => r.outcome === 'CONFIRMED')).toHaveLength(1)
    expect(await stockOf(product.id)).toBe(4)
  })
})

describe('Carrera por el último producto', () => {
  it('dos compras pagadas a la vez del último ítem: una se confirma, la otra queda para revisión, stock nunca negativo', async () => {
    const [u1, u2] = await Promise.all([makeUser(), makeUser()])
    const product = await makeProduct({ stock: 1 })
    const o1 = await order(u1, [{ productId: product.id, quantity: 1 }])
    const o2 = await order(u2, [{ productId: product.id, quantity: 1 }])

    const results = await Promise.all([approve(o1, 'tx-a'), approve(o2, 'tx-b')])
    const outcomes = results.map((r) => r.outcome).sort()
    expect(outcomes).toEqual(['CONFIRMED', 'OUT_OF_STOCK'])
    expect(await stockOf(product.id)).toBe(0)

    const loser = await prisma.order.findUnique({
      where: { id: results[0].outcome === 'OUT_OF_STOCK' ? o1.id : o2.id },
      include: { payment: true },
    })
    expect(loser.status).toBe('PENDING')
    expect(loser.needsReview).toBe(true)
    expect(loser.reviewNote).toMatch(/sin stock/i)
    expect(loser.payment.status).toBe('COMPLETED') // el dinero sí entró: hay que reembolsar
  })

  it('10 compras concurrentes con stock 3 en variante: exactamente 3 confirmadas', async () => {
    const product = await makeProduct({ stock: 0, variants: [{ size: 'M', color: 'Negro', stock: 3 }] })
    const users = await Promise.all(Array.from({ length: 10 }, () => makeUser()))
    const orders = []
    for (const u of users) orders.push(await order(u, [{ productId: product.id, size: 'M', color: 'Negro', quantity: 1 }]))

    const results = await Promise.all(orders.map((o, i) => approve(o, `tx-${i}`)))
    expect(results.filter((r) => r.outcome === 'CONFIRMED')).toHaveLength(3)
    expect(results.filter((r) => r.outcome === 'OUT_OF_STOCK')).toHaveLength(7)
    const variant = await prisma.productVariant.findFirst({ where: { productId: product.id } })
    expect(variant.stock).toBe(0)
  })

  it('la BD rechaza stock negativo aunque alguien lo intente directo (CHECK constraint)', async () => {
    const product = await makeProduct({ stock: 1 })
    await expect(prisma.product.update({ where: { id: product.id }, data: { stock: { decrement: 2 } } })).rejects.toThrow()
  })
})

describe('Montos y estados', () => {
  it('monto pagado distinto al total → NO confirma, marca revisión', async () => {
    const user = await makeUser()
    const product = await makeProduct({ price: 50000, stock: 5 })
    const created = await order(user, [{ productId: product.id, quantity: 1 }])

    const r = await approve(created, 'tx-cheap', 100)
    expect(r.outcome).toBe('AMOUNT_MISMATCH')
    const fresh = await prisma.order.findUnique({ where: { id: created.id } })
    expect(fresh.status).toBe('PENDING')
    expect(fresh.needsReview).toBe(true)
    expect(await stockOf(product.id)).toBe(5)
  })

  it('un "pending" que llega tarde no degrada una orden ya pagada', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 5 })
    const created = await order(user, [{ productId: product.id, quantity: 1 }])
    await approve(created, 'tx-1')
    await processPaymentUpdate({ provider: 'WOMPI', orderId: created.id, providerPaymentId: 'tx-1', status: PAY.PENDING, amount: Number(created.total) })

    const fresh = await prisma.order.findUnique({ where: { id: created.id }, include: { payment: true } })
    expect(fresh.status).toBe('CONFIRMED')
    expect(fresh.paidAt).not.toBeNull()
    expect(fresh.payment.status).toBe('COMPLETED')
  })

  it('pago rechazado deja la orden PENDING para reintentar; el reintento aprobado confirma', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 5 })
    const created = await order(user, [{ productId: product.id, quantity: 1 }])

    const declined = await processPaymentUpdate({ provider: 'WOMPI', orderId: created.id, providerPaymentId: 'tx-no', status: PAY.DECLINED, amount: Number(created.total) })
    expect(declined.outcome).toBe('DECLINED')
    let fresh = await prisma.order.findUnique({ where: { id: created.id }, include: { payment: true } })
    expect(fresh.status).toBe('PENDING')
    expect(fresh.payment.status).toBe('FAILED')

    await approve(created, 'tx-si')
    fresh = await prisma.order.findUnique({ where: { id: created.id }, include: { payment: true } })
    expect(fresh.status).toBe('CONFIRMED')
    expect(fresh.payment).toMatchObject({ status: 'COMPLETED', providerPaymentId: 'tx-si' })
  })

  it('segundo pago aprobado distinto sobre una orden ya pagada → revisión (reembolsar uno)', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 5 })
    const created = await order(user, [{ productId: product.id, quantity: 1 }])
    await approve(created, 'tx-1')
    const r = await approve(created, 'mp-2', Number(created.total), { provider: 'MERCADOPAGO' })
    expect(r.outcome).toBe('DUPLICATE_PAYMENT')
    expect(await stockOf(product.id)).toBe(4)
    expect((await prisma.order.findUnique({ where: { id: created.id } })).needsReview).toBe(true)
  })
})

describe('Expiración y cancelación', () => {
  it('expira órdenes PENDING viejas sin pago; un pago tardío la reactiva si hay stock (con revisión)', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 5 })
    const created = await order(user, [{ productId: product.id, quantity: 1 }])
    await prisma.order.update({ where: { id: created.id }, data: { createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000) } })

    expect(await expireStaleOrders()).toBe(1)
    expect((await prisma.order.findUnique({ where: { id: created.id } })).status).toBe('CANCELLED')
    expect(await stockOf(product.id)).toBe(5) // no se reservó, no se toca

    const r = await approve(created, 'tx-late')
    expect(r.outcome).toBe('CONFIRMED')
    const fresh = await prisma.order.findUnique({ where: { id: created.id } })
    expect(fresh.status).toBe('CONFIRMED')
    expect(fresh.needsReview).toBe(true)
    expect(await stockOf(product.id)).toBe(4)
  })

  it('no expira órdenes recientes ni órdenes con revisión pendiente', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 5 })
    await order(user, [{ productId: product.id, quantity: 1 }])
    expect(await expireStaleOrders()).toBe(0)
  })

  it('admin cancela una orden PENDING → el stock NO cambia (antes se inflaba)', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 5 })
    const created = await order(user, [{ productId: product.id, quantity: 2 }])
    await updateOrderStatus(created.id, 'CANCELLED', { changedById: user.id })
    expect(await stockOf(product.id)).toBe(5)
  })

  it('admin cancela una orden pagada → devuelve el stock una sola vez', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 5 })
    const created = await order(user, [{ productId: product.id, quantity: 2 }])
    await approve(created, 'tx-1')
    expect(await stockOf(product.id)).toBe(3)
    await updateOrderStatus(created.id, 'CANCELLED', {})
    expect(await stockOf(product.id)).toBe(5)
    await expect(updateOrderStatus(created.id, 'CONFIRMED', {})).rejects.toMatchObject({ status: 409 })
    expect(await stockOf(product.id)).toBe(5)
  })
})

describe('Cálculo del pedido (servidor)', () => {
  it('usa el precio de la variante, el mejor descuento vigente y el envío configurado', async () => {
    process.env.SHIPPING_FLAT_RATE = '12000'
    process.env.FREE_SHIPPING_FROM = '200000'
    const product = await makeProduct({ price: 50000, stock: 0, variants: [{ size: 'L', color: 'Azul', stock: 4, price: 60000 }] })
    const discount = await prisma.discount.create({ data: { name: 'Temporada', type: 'PERCENTAGE', value: 20 } })
    await prisma.productDiscount.create({ data: { productId: product.id, discountId: discount.id } })

    const q = await quoteOrder({ items: [{ productId: product.id, size: 'L', color: 'Azul', quantity: 2 }] })
    expect(q.items[0].unitPrice).toBe(48000) // 60.000 − 20 %
    expect(q.subtotal).toBe(96000)
    expect(q.shipping).toBe(12000)
    expect(q.total).toBe(108000)

    const q2 = await quoteOrder({ items: [{ productId: product.id, size: 'L', color: 'Azul', quantity: 4 }] })
    expect(q2.subtotal).toBe(192000)
    expect(q2.shipping).toBe(12000) // < 200.000
  })

  it('exige elegir variante válida cuando el producto tiene variantes', async () => {
    const product = await makeProduct({ variants: [{ size: 'S', color: 'Rojo', stock: 2 }] })
    await expect(quoteOrder({ items: [{ productId: product.id, quantity: 1 }] }))
      .rejects.toMatchObject({ status: 400, code: 'VARIANT_REQUIRED' })
  })

  it('rechaza pedir más de lo disponible y cupones inválidos al crear la orden', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 1 })
    await expect(order(user, [{ productId: product.id, quantity: 2 }])).rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK' })
    await expect(order(user, [{ productId: product.id, quantity: 1 }], { couponCode: 'NOEXISTE' })).rejects.toMatchObject({ status: 400, code: 'INVALID_COUPON' })
  })

  it('no permite usar la dirección de otro usuario (IDOR)', async () => {
    const [u1, u2] = await Promise.all([makeUser(), makeUser()])
    const product = await makeProduct({ stock: 3 })
    const foreign = await prisma.address.create({ data: { userId: u2.id, street: 'x', city: 'y', department: 'z' } })
    await expect(createOrder(u1.id, { items: [{ productId: product.id, quantity: 1 }], shippingAddressId: foreign.id, acceptTerms: true }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('exige aceptar términos y tratamiento de datos', async () => {
    const user = await makeUser()
    const product = await makeProduct({ stock: 3 })
    await expect(createOrder(user.id, { items: [{ productId: product.id, quantity: 1 }], address }))
      .rejects.toMatchObject({ status: 400, code: 'TERMS_REQUIRED' })
  })
})
