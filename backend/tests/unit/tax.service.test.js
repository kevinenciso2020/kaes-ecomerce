import { describe, it, expect } from 'vitest'
import { GENERAL_RATE, isValidRate, finalPrice, basePriceFromFinal } from '../../src/services/tax.service.js'

describe('finalPrice', () => {
  it('suma 19 % y redondea a peso entero', () => {
    expect(finalPrice(20000, 19)).toBe(23800)
    expect(finalPrice(59900, 19)).toBe(71281)
  })
  it('tasa 0 devuelve el mismo valor (exento)', () => {
    expect(finalPrice(45000, 0)).toBe(45000)
  })
  it('redondea medios hacia arriba', () => {
    expect(finalPrice(1010, 5)).toBe(1061)   // 1060.5 → 1061
  })
  it('nunca devuelve decimales', () => {
    expect(Number.isInteger(finalPrice(33333.33, 19))).toBe(true)
  })
})

describe('basePriceFromFinal', () => {
  it('invierte el cálculo con 2 decimales', () => {
    expect(basePriceFromFinal(23800, 19)).toBe(20000)
    expect(basePriceFromFinal(49900, 19)).toBe(41932.77)
  })
  it('round-trip: el precio final no cambia', () => {
    for (const final of [9900, 49900, 59900, 129900]) {
      expect(finalPrice(basePriceFromFinal(final, 19), 19)).toBe(final)
    }
  })
})

describe('isValidRate', () => {
  it.each([[0, true], [19, true], [30, true], [-1, false], [31, false], [NaN, false], ['x', false], [null, false]])(
    '%s → %s', (v, ok) => expect(isValidRate(v)).toBe(ok))
  it('la tasa general es 19', () => expect(GENERAL_RATE).toBe(19))
})
