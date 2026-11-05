import { describe, it, expect } from 'vitest'
import {
  totalStock, isAvailable, availableSizes, availableColors,
  priceInfo, shuffle, shuffleMixed, repeatToFill,
} from '../src/lib/carousel.js'

const prod = (slug, category, variants = [], stock = 0) => ({
  slug, stock, variants, category: { slug: category, name: category },
})

describe('carousel: disponibilidad', () => {
  it('con variantes usa la suma de su stock (ignora el del producto)', () => {
    const p = prod('a', 'camisetas', [{ size: 'M', stock: 0 }, { size: 'L', stock: 2 }], 0)
    expect(totalStock(p)).toBe(2)
    expect(isAvailable(p)).toBe(true)
    expect(isAvailable(prod('b', 'x', [{ size: 'M', stock: 0 }], 10))).toBe(false)
  })

  it('sin variantes usa el stock del producto', () => {
    expect(isAvailable(prod('a', 'x', [], 3))).toBe(true)
    expect(isAvailable(prod('a', 'x', [], 0))).toBe(false)
  })

  it('sin slug no se puede enlazar: no disponible', () => {
    expect(isAvailable({ stock: 5, variants: [] })).toBe(false)
  })
})

describe('carousel: tallas y colores', () => {
  const p = prod('a', 'x', [
    { size: 'XL', color: 'Negro', stock: 1 },
    { size: 'S', color: 'Blanco', stock: 4 },
    { size: 'M', color: 'Negro', stock: 0 },
    { size: 'S', color: 'Negro', stock: 2 },
  ])

  it('solo tallas con stock, sin repetir y en orden natural', () => {
    expect(availableSizes(p)).toEqual(['S', 'XL'])
  })

  it('solo colores con stock, sin repetir', () => {
    expect(availableColors(p)).toEqual(['Negro', 'Blanco'])
  })
})

describe('carousel: precio', () => {
  it('detecta la oferta y el porcentaje', () => {
    expect(priceInfo({ price: '100000', finalPrice: 80000 })).toEqual({ price: 100000, final: 80000, hasOffer: true, offerPct: 20 })
  })
  it('sin finalPrice usa el precio', () => {
    expect(priceInfo({ price: '50000' })).toMatchObject({ final: 50000, hasOffer: false, offerPct: 0 })
  })
})

describe('carousel: orden aleatorio', () => {
  it('shuffle conserva los elementos y no muta la entrada', () => {
    const input = [1, 2, 3, 4, 5]
    const out = shuffle(input, () => 0.3)
    expect(out.sort()).toEqual([1, 2, 3, 4, 5])
    expect(input).toEqual([1, 2, 3, 4, 5])
  })

  it('shuffleMixed intercala categorías', () => {
    const items = [
      prod('c1', 'camisetas'), prod('c2', 'camisetas'), prod('c3', 'camisetas'),
      prod('p1', 'pantalones'), prod('p2', 'pantalones'), prod('s1', 'shorts'),
    ]
    const out = shuffleMixed(items, () => 0.5)
    expect(out.map((p) => p.slug).sort()).toEqual(['c1', 'c2', 'c3', 'p1', 'p2', 's1'])
    // las tres primeras son de categorías distintas
    expect(new Set(out.slice(0, 3).map((p) => p.category.slug)).size).toBe(3)
  })
})

describe('carousel: repeatToFill', () => {
  it('repite hasta alcanzar el mínimo', () => {
    expect(repeatToFill([1, 2, 3, 4], 12)).toHaveLength(12)
    expect(repeatToFill([1, 2, 3, 4, 5], 12)).toHaveLength(15)
    expect(repeatToFill(Array.from({ length: 20 }, (_, i) => i), 12)).toHaveLength(20)
    expect(repeatToFill([], 12)).toEqual([])
  })
})
