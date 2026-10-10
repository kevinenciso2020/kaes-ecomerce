// Desglose de montos para la factura electrónica. Funciones puras.
//
// Los precios de la tienda incluyen IVA. Aquí se separa base gravable e IVA por
// línea, se prorratea el cupón entre las líneas de producto y se agrega el envío
// como línea aparte. Toda la aritmética va en centavos enteros para evitar
// errores de coma flotante; la diferencia de redondeo frente al total cobrado se
// informa en PayableRoundingAmount (Anexo 1.9, numeral 5.2.1).

const toCents = (v) => Math.round(Number(v) * 100)
export const formatMoney = (cents) => (cents / 100).toFixed(2)
const bp = (rate) => Math.round(Number(rate) * 100)

/** Base sin IVA (centavos) a partir de un valor con IVA (centavos). */
const baseFromGross = (grossCents, rate) => Math.round((grossCents * 10000) / (10000 + bp(rate)))
const taxOf = (baseCents, rate) => Math.round((baseCents * bp(rate)) / 10000)

/** Reparte `totalCents` proporcionalmente a `weights` (residuo mayor). */
const allocate = (totalCents, weights) => {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (totalCents <= 0 || sum <= 0) return weights.map(() => 0)
  const raw = weights.map((w) => (totalCents * w) / sum)
  const parts = raw.map(Math.floor)
  let rest = totalCents - parts.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0])
  for (let k = 0; rest > 0; k++, rest--) parts[order[k % order.length][1]]++
  return parts
}

const buildLine = ({ description, code, quantity, grossCents, discountCents, rate, taxMode }) => {
  const baseBefore = baseFromGross(grossCents, rate)
  const unitPrice = Math.round(baseBefore / quantity)
  const grossBase = unitPrice * quantity
  let base = discountCents > 0 ? baseFromGross(grossCents - discountCents, rate) : grossBase
  if (base > grossBase) base = grossBase
  const allowance = grossBase - base
  const tax = taxMode === 'excluded' ? 0 : taxOf(base, rate)
  return {
    description,
    code,
    quantity,
    unitPrice,
    allowance,
    base,
    tax,
    rate: Number(rate),
    // 'taxed' (IVA > 0), 'exempt' (0 %, se informa) o 'excluded' (no se informa IVA).
    taxMode,
  }
}

/**
 * @param {object} p
 * @param {Array<{description:string, code:string, quantity:number, unitPrice:number|string, taxRate:number|string}>} p.items
 *        unitPrice: precio unitario CON IVA ya con descuentos de producto.
 * @param {number|string} p.discount  descuento de cupón (con IVA) sobre los productos
 * @param {number|string} p.shipping  envío cobrado (con IVA si aplica)
 * @param {number} p.shippingTaxRate  tarifa de IVA del envío (0 = excluido)
 * @param {number|string} p.total     total cobrado al cliente
 */
export const computeInvoiceAmounts = ({ items, discount = 0, shipping = 0, shippingTaxRate = 0, total }) => {
  const grosses = items.map((i) => toCents(i.unitPrice) * i.quantity)
  const discounts = allocate(toCents(discount), grosses)

  const lines = items.map((item, idx) => {
    const rate = Number(item.taxRate ?? 0)
    return buildLine({
      description: item.description,
      code: item.code,
      quantity: item.quantity,
      grossCents: grosses[idx],
      discountCents: discounts[idx],
      rate,
      taxMode: rate > 0 ? 'taxed' : 'exempt',
    })
  })

  const shippingCents = toCents(shipping)
  if (shippingCents > 0) {
    const rate = Number(shippingTaxRate ?? 0)
    lines.push(buildLine({
      description: 'Servicio de envío',
      code: 'ENVIO',
      quantity: 1,
      grossCents: shippingCents,
      discountCents: 0,
      rate,
      taxMode: rate > 0 ? 'taxed' : 'excluded',
    }))
  }

  const subtotalsByRate = new Map()
  for (const l of lines) {
    if (l.taxMode === 'excluded') continue
    const key = l.rate.toFixed(2)
    const acc = subtotalsByRate.get(key) ?? { rate: l.rate, taxable: 0, tax: 0 }
    acc.taxable += l.base
    acc.tax += l.tax
    subtotalsByRate.set(key, acc)
  }
  const taxSubtotals = [...subtotalsByRate.values()].sort((a, b) => b.rate - a.rate)

  const lineExtension = lines.reduce((s, l) => s + l.base, 0)
  const allowanceTotal = lines.reduce((s, l) => s + l.allowance, 0)
  const taxExclusive = taxSubtotals.reduce((s, t) => s + t.taxable, 0)
  const taxTotal = taxSubtotals.reduce((s, t) => s + t.tax, 0)
  const taxInclusive = lineExtension + taxTotal
  const payable = total == null ? taxInclusive : toCents(total)

  return {
    lines,
    taxSubtotals,
    totals: {
      lineExtension,
      allowanceTotal,
      taxExclusive,
      taxTotal,
      taxInclusive,
      rounding: payable - taxInclusive,
      payable,
    },
  }
}
