import { describe, it, expect } from 'vitest'
import { computeInvoiceAmounts, formatMoney } from '../../../src/services/einvoice/amounts.js'

const item = (unitPrice, quantity = 1, taxRate = 19, description = 'Camiseta') =>
  ({ description, code: 'SKU', quantity, unitPrice, taxRate })

describe('computeInvoiceAmounts', () => {
  it('separa base e IVA de un precio con IVA incluido', () => {
    const r = computeInvoiceAmounts({ items: [item(119000)], total: 119000 })
    expect(r.lines[0]).toMatchObject({ base: 10000000, tax: 1900000, allowance: 0, taxMode: 'taxed' })
    expect(r.totals).toMatchObject({ lineExtension: 10000000, taxTotal: 1900000, payable: 11900000, rounding: 0 })
  })

  it('cuadra el total cobrado con PayableRoundingAmount dentro de la tolerancia DIAN', () => {
    const r = computeInvoiceAmounts({ items: [item(71281, 3), item(45000, 1, 0)], total: 71281 * 3 + 45000 })
    expect(r.totals.payable).toBe((71281 * 3 + 45000) * 100)
    expect(Math.abs(r.totals.rounding)).toBeLessThanOrEqual(200)
    expect(r.totals.taxInclusive + r.totals.rounding).toBe(r.totals.payable)
  })

  it('agrupa subtotales por tarifa e informa el 0 % (exento)', () => {
    const r = computeInvoiceAmounts({ items: [item(119000), item(50000, 2, 0)], total: 219000 })
    expect(r.taxSubtotals).toEqual([
      { rate: 19, taxable: 10000000, tax: 1900000 },
      { rate: 0, taxable: 10000000, tax: 0 },
    ])
    expect(r.totals.taxExclusive).toBe(20000000)
  })

  it('prorratea el cupón entre líneas como descuento de línea', () => {
    const r = computeInvoiceAmounts({ items: [item(119000), item(59500)], discount: 17850, total: 160650 })
    const totalAllowanceGross = r.lines.reduce((s, l) => s + l.allowance + Math.round(l.allowance * 0.19), 0)
    expect(Math.abs(totalAllowanceGross - 1785000)).toBeLessThanOrEqual(2)
    for (const l of r.lines) expect(l.unitPrice * l.quantity - l.allowance).toBe(l.base)
    expect(Math.abs(r.totals.rounding)).toBeLessThanOrEqual(200)
  })

  it('agrega el envío como línea excluida (sin IVA) por defecto', () => {
    const r = computeInvoiceAmounts({ items: [item(119000)], shipping: 12000, total: 131000 })
    const envio = r.lines.at(-1)
    expect(envio).toMatchObject({ description: 'Servicio de envío', base: 1200000, tax: 0, taxMode: 'excluded' })
    expect(r.taxSubtotals).toHaveLength(1)
    expect(r.totals.lineExtension).toBe(11200000)
    expect(r.totals.taxExclusive).toBe(10000000)
    expect(r.totals.rounding).toBe(0)
  })

  it('aplica IVA al envío si se configura una tarifa', () => {
    const r = computeInvoiceAmounts({ items: [item(119000)], shipping: 11900, shippingTaxRate: 19, total: 130900 })
    expect(r.lines.at(-1)).toMatchObject({ base: 1000000, tax: 190000, taxMode: 'taxed' })
    expect(r.taxSubtotals[0]).toEqual({ rate: 19, taxable: 11000000, tax: 2090000 })
  })

  it('no produce valores negativos', () => {
    const r = computeInvoiceAmounts({ items: [item(1, 7), item(3, 3, 5)], discount: 1, total: 15 })
    for (const l of r.lines) {
      expect(l.base).toBeGreaterThanOrEqual(0)
      expect(l.allowance).toBeGreaterThanOrEqual(0)
    }
  })

  it('formatMoney usa 2 decimales', () => {
    expect(formatMoney(11900000)).toBe('119000.00')
    expect(formatMoney(5)).toBe('0.05')
  })
})
