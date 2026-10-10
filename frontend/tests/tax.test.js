import { describe, it, expect } from 'vitest'
import { finalPrice, formatCOP } from '../src/lib/tax.js'

describe('finalPrice (debe coincidir con el backend)', () => {
  it('suma el IVA y redondea a peso', () => {
    expect(finalPrice(20000, 19)).toBe(23800)
    expect(finalPrice(59900, 19)).toBe(71281)
    expect(finalPrice(1010, 5)).toBe(1061)
  })
  it('exento: igual', () => expect(finalPrice(45000, 0)).toBe(45000))
  it('entrada vacía o inválida → 0', () => {
    expect(finalPrice('', 19)).toBe(0)
    expect(finalPrice('abc', 19)).toBe(0)
  })
})

describe('formatCOP', () => {
  it('formatea con separador de miles', () => expect(formatCOP(23800)).toBe('$23.800'))
})

import { ivaBreakdown } from '../src/lib/tax.js'

describe('ivaBreakdown', () => {
  it('separa precio, IVA y total (19 %)', () => {
    expect(ivaBreakdown(71400, 19)).toEqual({ base: 60000, iva: 11400, total: 71400 })
  })
  it('exento: IVA 0', () => {
    expect(ivaBreakdown(60000, 0)).toEqual({ base: 60000, iva: 0, total: 60000 })
  })
  it('base + iva siempre suma el total', () => {
    for (const t of [71, 1999, 35700, 123457]) {
      const b = ivaBreakdown(t, 19)
      expect(b.base + b.iva).toBe(t)
    }
  })
  it('entrada inválida → ceros', () => {
    expect(ivaBreakdown(NaN, 19)).toEqual({ base: 0, iva: 0, total: 0 })
  })
})
