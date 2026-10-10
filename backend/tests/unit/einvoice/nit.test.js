import { describe, it, expect } from 'vitest'
import { computeNitDv } from '../../../src/services/einvoice/nit.js'

describe('computeNitDv', () => {
  it.each([
    ['800197268', '4'], // DIAN
    ['900373115', '3'],
    ['860002964', '4'],
    ['890903938', '8'], // Bancolombia
  ])('NIT %s → DV %s', (nit, dv) => {
    expect(computeNitDv(nit)).toBe(dv)
  })
  it('ignora puntos y guiones', () => {
    expect(computeNitDv('800.197.268')).toBe('4')
  })
  it('devuelve null si no hay dígitos', () => {
    expect(computeNitDv('')).toBeNull()
  })
})
