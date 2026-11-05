import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'

const log = logger.child({ component: 'dashboard' })

/**
 * Devuelve un timestamp (Date) en UTC truncado al inicio del bucket.
 * Usamos DATE_TRUNC en SQL para que sea la base de datos quien agrupe —
 * más preciso y soporta zonas horarias vía server_timezone.
 */
const RANGE_DAYS = {
  '7d':  7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
}

const computeRangeStart = (range = '30d') => {
  const days = RANGE_DAYS[range] || 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

/**
 * Overview general — 4 stat cards.
 * Versión extendida de la anterior; usa más agregaciones en paralelo.
 */
export const getOverview = async () => {
  const [totalUsers, totalProducts, totalOrders, revenueAgg, todayOrders, todayRevenueAgg] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.product.count(),
    prisma.order.count(),
    prisma.order.aggregate({
      _sum:   { total: true },
      where:  { status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } },
    }),
    prisma.order.count({
      where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
    prisma.order.aggregate({
      _sum:  { total: true },
      where: {
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        status:    { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      },
    }),
  ])

  // Ticket promedio = revenue total / orders (no cancelled)
  const paidOrdersCount = await prisma.order.count({
    where: { status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } },
  })
  const revenue = Number(revenueAgg._sum.total || 0)
  const avgTicket = paidOrdersCount > 0 ? revenue / paidOrdersCount : 0

  return {
    totalUsers,
    totalProducts,
    totalOrders,
    revenue,
    avgTicket,
    todayOrders,
    todayRevenue: Number(todayRevenueAgg._sum.total || 0),
  }
}

/**
 * Serie temporal de ventas, agrupada por día (o mes en '12m') en hora de Colombia.
 * Devuelve siempre TODOS los buckets del rango (rellena con 0 los días sin ventas).
 */
const TZ = 'America/Bogota'

// 'YYYY-MM-DD' de un instante, en hora de Colombia
const bogotaDateKey = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

export const getSalesSeries = async ({ range = '30d' } = {}) => {
  const start = computeRangeStart(range)
  const bucket = range === '12m' ? 'month' : 'day'

  // La unidad va como literal SQL (lista blanca) y no como parámetro: si se pasa
  // como parámetro, Postgres ve DATE_TRUNC($1…) y DATE_TRUNC($3…) como expresiones
  // distintas y el GROUP BY falla. Se agrupa por posición (GROUP BY 1).
  const unit = Prisma.raw(bucket === 'month' ? "'month'" : "'day'")
  const rows = await prisma.$queryRaw`
    SELECT
      TO_CHAR(DATE_TRUNC(${unit}, ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS bucket,
      COUNT(*)::int                    AS "orderCount",
      COALESCE(SUM("total"), 0)::float AS revenue
    FROM "orders"
    WHERE "createdAt" >= ${start}
      AND "status" IN ('CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED')
    GROUP BY 1
    ORDER BY 1 ASC
  `

  // Rellenar buckets vacíos recorriendo fechas de calendario (en UTC puro para
  // que el cambio de día no dependa de la zona horaria del servidor).
  const map = new Map(rows.map((r) => [r.bucket, r]))
  const toKey = (d) => d.toISOString().slice(0, 10)
  const startKey = bogotaDateKey(start)
  const endKey = bogotaDateKey(new Date())
  const cursor = new Date(`${bucket === 'month' ? startKey.slice(0, 7) + '-01' : startKey}T00:00:00.000Z`)
  const end = new Date(`${bucket === 'month' ? endKey.slice(0, 7) + '-01' : endKey}T00:00:00.000Z`)

  const series = []
  while (cursor <= end) {
    const key = toKey(cursor)
    const found = map.get(key)
    series.push({
      // Mediodía UTC = mañana en Colombia: el navegador muestra el día correcto
      date:    `${key}T12:00:00.000Z`,
      revenue: found ? Number(found.revenue) : 0,
      orders:  found ? Number(found.orderCount) : 0,
    })
    if (bucket === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    else cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return { range, bucket, series }
}

/**
 * Top N productos más vendidos por unidades en el rango.
 */
export const getTopProducts = async ({ limit = 10, range = '90d' } = {}) => {
  const start = computeRangeStart(range)

  // groupBy en orderItem: sum quantity, group by product, join product
  const grouped = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: {
      order: {
        createdAt: { gte: start },
        status:    { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: Number(limit),
  })

  if (grouped.length === 0) return []

  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId) } },
    select: {
      id: true, name: true, slug: true,
      images: { where: { isMain: true }, take: 1 },
      category: { select: { name: true } },
    },
  })

  const byId = new Map(products.map((p) => [p.id, p]))

  return grouped.map((g) => ({
    ...byId.get(g.productId),
    sold: g._sum.quantity || 0,
  }))
}

/**
 * Distribución de ventas por categoría — para gráfico de torta.
 */
export const getSalesByCategory = async ({ range = '90d' } = {}) => {
  const start = computeRangeStart(range)

  // Traer orders pagados del rango con items.product.categoryId
  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        createdAt: { gte: start },
        status:    { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      },
    },
    select: {
      quantity: true,
      price: true,
      product: { select: { categoryId: true, category: { select: { name: true, slug: true } } } },
    },
  })

  const map = new Map()
  for (const item of items) {
    const cat = item.product.category
    if (!cat) continue
    const revenue = Number(item.price) * item.quantity
    const current = map.get(cat.id) || { categoryId: cat.id, name: cat.name, slug: cat.slug, revenue: 0, units: 0 }
    current.revenue += revenue
    current.units   += item.quantity
    map.set(cat.id, current)
  }

  return Array.from(map.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((c) => ({ ...c, revenue: Math.round(c.revenue) }))
}

/**
 * Órdenes recientes (top N).
 */
export const getRecentOrders = async ({ limit = 10 } = {}) => {
  return prisma.order.findMany({
    take: Number(limit),
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { name: true, email: true } },
      _count: { select: { items: true } },
    },
  })
}

/**
 * Productos con stock bajo — usa el lowStockThreshold por variante
 * (fallback al del producto). Top N.
 */
export const getLowStock = async ({ limit = 20 } = {}) => {
  // Primero candidatos con stock <= 5 (umbral duro para filtrar)
  const candidates = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { stock: { lte: 5 } },
        { variants: { some: { stock: { lte: 5 } } } },
      ],
    },
    include: {
      variants: { select: { size: true, color: true, stock: true, lowStockThreshold: true } },
      images: { where: { isMain: true }, take: 1 },
    },
  })

  return candidates
    .map((p) => {
      const lowVariants = p.variants.filter((v) => v.stock <= (v.lowStockThreshold ?? p.lowStockThreshold ?? 5))
      return { ...p, lowVariants }
    })
    .filter((p) => p.lowVariants.length > 0)
    .slice(0, Number(limit))
}
