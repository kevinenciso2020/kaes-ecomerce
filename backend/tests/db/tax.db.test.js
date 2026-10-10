import { describe, it, expect, beforeEach, afterAll } from 'vitest'

const { prisma } = await import('../../src/config/prisma.js')
const { setRate, applyPendingRate, getCurrentRate, getTaxSetting } = await import('../../src/services/tax-settings.service.js')

const TABLES = [
  'payment_events', 'payments', 'order_status_logs', 'order_items', 'orders', 'cart_items',
  'product_discounts', 'product_variants', 'product_images', 'product_available_sizes', 'products', 'categories', 'users',
]

let seq = 0
const makeProduct = async ({ basePrice, taxRate = 19, variants } = {}) => {
  const category = await prisma.category.upsert({
    where: { slug: 'camisetas' }, update: {}, create: { name: 'Camisetas', slug: 'camisetas' },
  })
  const price = Math.round(basePrice * (1 + taxRate / 100))
  return prisma.product.create({
    data: {
      name: `P${++seq}`, slug: `p-${seq}`, description: '', stock: 5, categoryId: category.id,
      basePrice, taxRate, price, variants: variants ? { create: variants } : undefined,
    },
    include: { variants: true },
  })
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`)
  await prisma.taxSetting.upsert({
    where: { id: 1 }, update: { rate: 19, pendingRate: null }, create: { id: 1, rate: 19 },
  })
})

afterAll(async () => { await prisma.$disconnect() })

describe('setRate', () => {
  it('recalcula productos y variantes con la tasa general; el exento no cambia', async () => {
    const normal = await makeProduct({
      basePrice: 20000,
      variants: [{ size: 'M', color: 'Azul', stock: 2, basePrice: 30000, price: 35700 }, { size: 'L', color: 'Azul', stock: 2 }],
    })
    const exento = await makeProduct({ basePrice: 10000, taxRate: 0 })

    const res = await setRate(5, 'u1')
    expect(res).toMatchObject({ rate: 5, changed: true })

    const p = await prisma.product.findUnique({ where: { id: normal.id }, include: { variants: true } })
    expect(Number(p.taxRate)).toBe(5)
    expect(Number(p.price)).toBe(21000)
    expect(Number(p.variants.find((v) => v.size === 'M').price)).toBe(31500)
    expect(p.variants.find((v) => v.size === 'L').price).toBeNull()

    const e = await prisma.product.findUnique({ where: { id: exento.id } })
    expect(Number(e.taxRate)).toBe(0)
    expect(Number(e.price)).toBe(10000)
    expect(await getCurrentRate()).toBe(5)
  })

  it('no altera el precio de pedidos ya creados', async () => {
    const product = await makeProduct({ basePrice: 20000 })
    const user = await prisma.user.create({ data: { email: 'a@a.co', password: 'x', name: 'A', emailVerified: true } })
    const order = await prisma.order.create({
      data: {
        userId: user.id, total: 23800, subtotal: 23800,
        items: { create: [{ productId: product.id, quantity: 1, price: 23800 }] },
      },
      include: { items: true },
    })
    await setRate(5, 'u1')
    const item = await prisma.orderItem.findUnique({ where: { id: order.items[0].id } })
    expect(Number(item.price)).toBe(23800)
  })

  it('misma tasa → changed:false y no toca nada', async () => {
    const p = await makeProduct({ basePrice: 20000 })
    const res = await setRate(19, 'u1')
    expect(res.changed).toBe(false)
    expect(Number((await prisma.product.findUnique({ where: { id: p.id } })).price)).toBe(23800)
  })

  it('rechaza tasas inválidas', async () => {
    await expect(setRate(45, 'u1')).rejects.toMatchObject({ status: 400 })
    await expect(setRate(-1, 'u1')).rejects.toMatchObject({ status: 400 })
  })
})

describe('applyPendingRate', () => {
  it('aplica la tasa detectada y limpia pendingRate', async () => {
    await makeProduct({ basePrice: 20000 })
    await prisma.taxSetting.update({ where: { id: 1 }, data: { pendingRate: 21 } })
    const res = await applyPendingRate('u1')
    expect(res.rate).toBe(21)
    const s = await getTaxSetting()
    expect(s.rate).toBe(21)
    expect(s.pendingRate).toBeNull()
  })

  it('409 si no hay tasa pendiente', async () => {
    await expect(applyPendingRate('u1')).rejects.toMatchObject({ status: 409 })
  })
})
