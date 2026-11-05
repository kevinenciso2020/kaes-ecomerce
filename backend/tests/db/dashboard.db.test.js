import { describe, it, expect, beforeEach, afterAll } from 'vitest'

const { prisma } = await import('../../src/config/prisma.js')
const { getSalesSeries } = await import('../../src/services/dashboard.service.js')

const DAY = 24 * 60 * 60 * 1000
const bogotaKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d)

let userId
const makeOrder = (status, total, createdAt) => prisma.order.create({
  data: { userId, status, subtotal: total, total, createdAt },
})

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "order_items", "orders", "users" CASCADE')
  const user = await prisma.user.create({ data: { email: 'ventas@test.co', password: 'x', name: 'Ventas' } })
  userId = user.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('getSalesSeries (BD real)', () => {
  it('agrupa por día en hora de Colombia, rellena días vacíos y excluye órdenes sin pagar', async () => {
    const now = new Date()
    const twoDaysAgo = new Date(now.getTime() - 2 * DAY)
    await makeOrder('CONFIRMED', 100000, now)
    await makeOrder('DELIVERED', 50000, now)
    await makeOrder('PENDING', 999999, now)
    await makeOrder('SHIPPED', 30000, twoDaysAgo)

    const { bucket, series } = await getSalesSeries({ range: '7d' })

    expect(bucket).toBe('day')
    expect(series).toHaveLength(8)
    const byDay = Object.fromEntries(series.map((s) => [s.date.slice(0, 10), s]))
    expect(byDay[bogotaKey(now)]).toMatchObject({ revenue: 150000, orders: 2 })
    expect(byDay[bogotaKey(twoDaysAgo)]).toMatchObject({ revenue: 30000, orders: 1 })
    expect(series.reduce((s, d) => s + d.orders, 0)).toBe(3)
  })

  it('agrupa por mes en el rango de 12 meses', async () => {
    const now = new Date()
    await makeOrder('CONFIRMED', 70000, now)
    await makeOrder('PROCESSING', 20000, new Date(now.getTime() - 100 * DAY))

    const { bucket, series } = await getSalesSeries({ range: '12m' })

    expect(bucket).toBe('month')
    expect(series.length).toBeGreaterThanOrEqual(12)
    expect(series.every((s) => s.date.slice(8, 10) === '01')).toBe(true)
    expect(series.at(-1).date.slice(0, 7)).toBe(bogotaKey(now).slice(0, 7))
    expect(series.at(-1)).toMatchObject({ revenue: 70000, orders: 1 })
    expect(series.reduce((s, d) => s + d.revenue, 0)).toBe(90000)
  })
})
