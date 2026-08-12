import { describe, it, expect } from 'vitest'
import { generateSlug } from '../../src/utils/slug.utils.js'

describe('generateSlug', () => {
  it('lowercases and dashes spaces', () => {
    expect(generateSlug('Camiseta Azul Marino')).toBe('camiseta-azul-marino')
  })

  it('strips diacritics', () => {
    expect(generateSlug('Camisa Añil')).toBe('camisa-anil')
    expect(generateSlug('Pantalón Café')).toBe('pantalon-cafe')
  })

  it('strips non-alphanumeric characters', () => {
    expect(generateSlug('¡Hola! ¿Qué tal?')).toBe('hola-que-tal')
    expect(generateSlug('100% Algodón!')).toBe('100-algodon')
  })

  it('collapses multiple spaces', () => {
    expect(generateSlug('  Hola   Mundo  ')).toBe('hola-mundo')
  })

  it('returns empty string for empty input', () => {
    expect(generateSlug('')).toBe('')
  })

  it('keeps dashes between words', () => {
    expect(generateSlug('ropa-de-verano')).toBe('ropa-de-verano')
  })

  it('handles a single word', () => {
    expect(generateSlug('VERANO')).toBe('verano')
  })
})