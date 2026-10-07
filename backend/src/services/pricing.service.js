import { prisma } from '../config/prisma.js'
import { validateCoupon } from './coupon.service.js'
import { insufficientStockError } from './stock.service.js'

// Única fuente de verdad para precios, descuentos, cupón, envío y total.
// La usan tanto el resumen del checkout (POST /orders/quote) como la creación
// de la orden, así lo que el cliente ve es exactamente lo que se cobra.

export const MAX_QTY_PER_LINE = 10
export const MAX_LINES = 30

const roundMoney = (n) => Math.round(n * 100) / 100

const badRequest = (message, extra = {}) =>
  Object.assign(new Error(message), { status: 400, ...extra })

/**
 * Envío configurable por variables de entorno (COP):
 *   SHIPPING_FLAT_RATE      costo fijo por pedido (0 = envío gratis siempre)
 *   FREE_SHIPPING_FROM      desde este subtotal (ya con descuentos) el envío es gratis (0 = nunca)
 */
export const computeShipping = (amount) => {
  const flat = Number.parseFloat(process.env.SHIPPING_FLAT_RATE || '0') || 0
  const freeFrom = Number.parseFloat(process.env.FREE_SHIPPING_FROM || '0') || 0
  if (flat <= 0) return 0
  if (freeFrom > 0 && amount >= freeFrom) return 0
  return roundMoney(flat)
}

export const shippingConfig = () => ({
  flatRate: Number.parseFloat(process.env.SHIPPING_FLAT_RATE || '0') || 0,
  freeFrom: Number.parseFloat(process.env.FREE_SHIPPING_FROM || '0') || 0,
  // Los precios de la tienda se publican con IVA incluido.
  taxIncluded: true,
})

const isDiscountActive = (d, now) =>
  d.isActive &&
  (!d.startsAt || d.startsAt <= now) &&
  (!d.endsAt || d.endsAt >= now)

/** Aplica el mejor descuento de producto vigente al precio unitario. */
export const applyProductDiscounts = (unitPrice, productDiscounts = [], now = new Date()) => {
  let best = unitPrice
  for (const pd of productDiscounts) {
    const d = pd.discount || pd
    if (!isDiscountActive(d, now)) continue
    const value = parseFloat(d.value)
    const candidate = d.type === 'PERCENTAGE' ? unitPrice * (1 - value / 100) : unitPrice - value
    if (candidate < best) best = candidate
  }
  return roundMoney(Math.max(0, best))
}

const lineKey = (i) => `${i.productId}::${i.size ?? ''}::${i.color ?? ''}`

/** Une líneas repetidas (mismo producto/talla/color) y valida cantidades. */
export const normalizeItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('Debes incluir al menos un producto')
  }
  const merged = new Map()
  for (const raw of items) {
    const quantity = Number.parseInt(raw?.quantity, 10)
    if (!raw?.productId || !Number.isInteger(quantity) || quantity < 1) {
      throw badRequest('Ítem inválido en el pedido')
    }
    const item = {
      productId: String(raw.productId),
      size:  raw.size ? String(raw.size) : null,
      color: raw.color ? String(raw.color) : null,
      quantity,
    }
    const key = lineKey(item)
    const prev = merged.get(key)
    merged.set(key, prev ? { ...prev, quantity: prev.quantity + quantity } : item)
  }
  const list = [...merged.values()]
  if (list.length > MAX_LINES) throw badRequest(`Máximo ${MAX_LINES} productos distintos por pedido`)
  for (const i of list) {
    if (i.quantity > MAX_QTY_PER_LINE) {
      throw badRequest(`Máximo ${MAX_QTY_PER_LINE} unidades por producto`)
    }
  }
  return list
}

/**
 * Calcula el pedido completo desde la BD.
 * Lanza 400 si un producto/variante no existe y 409 INSUFFICIENT_STOCK si no
 * alcanza el stock (chequeo informativo: el stock se descuenta al pagar).
 *
 * options.strictCoupon: si true, un cupón inválido lanza 400 (crear orden);
 * si false, se devuelve en `couponError` (resumen del checkout).
 */
export const buildQuote = async ({ items, couponCode }, { db = prisma, strictCoupon = false } = {}) => {
  const lines = normalizeItems(items)
  const now = new Date()

  const products = await db.product.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.productId))] }, isActive: true },
    include: {
      variants:  true,
      discounts: { include: { discount: true } },
      images:    { where: { isMain: true }, take: 1 },
    },
  })
  const byId = new Map(products.map((p) => [p.id, p]))

  const shortages = []
  const quoteItems = lines.map((line) => {
    const product = byId.get(line.productId)
    if (!product) throw badRequest('Uno de los productos ya no está disponible', { code: 'PRODUCT_UNAVAILABLE', productId: line.productId })

    let variant = null
    if (product.variants.length > 0) {
      variant = product.variants.find(
        (v) => (v.size ?? null) === line.size && (v.color ?? null) === line.color,
      )
      if (!variant) {
        throw badRequest(`Selecciona una talla y color válidos para "${product.name}"`, { code: 'VARIANT_REQUIRED', productId: product.id })
      }
    }

    const available = variant ? variant.stock : product.stock
    if (available < line.quantity) {
      shortages.push({
        productId: product.id,
        productName: product.name,
        size: line.size,
        color: line.color,
        requested: line.quantity,
        available,
      })
    }

    const basePrice = parseFloat(variant?.price ?? product.price)
    const unitPrice = applyProductDiscounts(basePrice, product.discounts, now)

    return {
      productId: product.id,
      variantId: variant?.id ?? null,
      name: product.name,
      slug: product.slug,
      image: product.images[0]?.url ?? null,
      size: line.size,
      color: line.color,
      colorHex: variant?.colorHex ?? null,
      sku: variant?.sku ?? null,
      quantity: line.quantity,
      basePrice,
      unitPrice,
      lineTotal: roundMoney(unitPrice * line.quantity),
    }
  })

  if (shortages.length > 0) {
    const detail = shortages
      .map((s) => `${s.productName}${s.size || s.color ? ` (${[s.size, s.color].filter(Boolean).join('/')})` : ''}: disponibles ${s.available}`)
      .join('; ')
    throw insufficientStockError(shortages, `Stock insuficiente — ${detail}`)
  }

  const subtotal = roundMoney(quoteItems.reduce((sum, i) => sum + i.lineTotal, 0))

  let discount = 0
  let appliedCoupon = null
  let couponError = null
  if (couponCode) {
    const result = await validateCoupon(couponCode, subtotal, db)
    if (result.valid) {
      discount = result.coupon.discount
      appliedCoupon = result.coupon
    } else if (strictCoupon) {
      throw badRequest(result.error, { code: 'INVALID_COUPON' })
    } else {
      couponError = result.error
    }
  }

  const afterDiscount = roundMoney(Math.max(0, subtotal - discount))
  const shipping = computeShipping(afterDiscount)
  const total = roundMoney(afterDiscount + shipping)

  return {
    items: quoteItems,
    subtotal,
    discount,
    shipping,
    total,
    coupon: appliedCoupon,
    couponError,
    taxIncluded: true,
    currency: 'COP',
  }
}
