import { describe, it, expect, vi } from 'vitest'

import {
  tryDeductStockForItems,
  restoreStockForItems,
  resolveStockTarget,
} from '../../src/services/stock.service.js'

// La concurrencia real (dos compras del último producto) se prueba contra
// PostgreSQL en tests/db/payments.db.test.js. Aquí sólo la lógica.

const makeTx = ({ variants = {}, stock = {} } = {}) => {
  // stock: { 'product:p1': 5, 'variant:v1': 2 }
  const current = { ...stock }
  const updateManyFor = (type) => vi.fn(async ({ where, data }) => {
    const key = `${type}:${where.id}`
    const available = current[key] ?? 0
    if (available >= where.stock.gte) {
      current[key] = available - data.stock.decrement
      return { count: 1 }
    }
    return { count: 0 }
  })
  const updateFor = (type) => vi.fn(async ({ where, data }) => {
    const key = `${type}:${where.id}`
    current[key] = (current[key] ?? 0) + (data.stock.increment ?? 0)
    return {}
  })
  return {
    current,
    productVariant: {
      findFirst: vi.fn(async ({ where }) => variants[`${where.productId}|${where.size}|${where.color}`] || null),
      updateMany: updateManyFor('variant'),
      update: updateFor('variant'),
    },
    product: {
      updateMany: updateManyFor('product'),
      update: updateFor('product'),
    },
  }
}

describe('resolveStockTarget', () => {
  it('usa variantId cuando el ítem ya lo tiene', async () => {
    const tx = makeTx()
    await expect(resolveStockTarget(tx, { productId: 'p1', variantId: 'v9' })).resolves.toEqual({ type: 'variant', id: 'v9' })
    expect(tx.productVariant.findFirst).not.toHaveBeenCalled()
  })

  it('busca la variante por talla/color y cae al producto si no existe', async () => {
    const tx = makeTx({ variants: { 'p1|M|Negro': { id: 'v1' } } })
    await expect(resolveStockTarget(tx, { productId: 'p1', size: 'M', color: 'Negro' })).resolves.toEqual({ type: 'variant', id: 'v1' })
    await expect(resolveStockTarget(tx, { productId: 'p1', size: 'L', color: 'Negro' })).resolves.toEqual({ type: 'product', id: 'p1' })
    await expect(resolveStockTarget(tx, { productId: 'p2' })).resolves.toEqual({ type: 'product', id: 'p2' })
  })
})

describe('tryDeductStockForItems', () => {
  it('descuenta producto y variante con UPDATE condicional (stock >= cantidad)', async () => {
    const tx = makeTx({ stock: { 'product:p1': 5, 'variant:v1': 3 } })
    const result = await tryDeductStockForItems(tx, [
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', variantId: 'v1', quantity: 3 },
    ])
    expect(result).toEqual({ ok: true, shortages: [] })
    expect(tx.current).toEqual({ 'product:p1': 3, 'variant:v1': 0 })
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', stock: { gte: 2 } },
      data: { stock: { decrement: 2 } },
    })
  })

  it('si un ítem no alcanza, revierte los ya descontados y reporta el faltante', async () => {
    const tx = makeTx({ stock: { 'product:p1': 5, 'variant:v1': 1 } })
    const result = await tryDeductStockForItems(tx, [
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', variantId: 'v1', quantity: 3, size: 'M', color: 'Negro' },
    ])
    expect(result.ok).toBe(false)
    expect(result.shortages).toEqual([
      { productId: 'p2', variantId: 'v1', size: 'M', color: 'Negro', requested: 3 },
    ])
    // p1 volvió a 5 (reversión exacta), v1 no se tocó
    expect(tx.current).toEqual({ 'product:p1': 5, 'variant:v1': 1 })
  })

  it('orden vacía → ok sin tocar nada', async () => {
    const tx = makeTx()
    await expect(tryDeductStockForItems(tx, [])).resolves.toEqual({ ok: true, shortages: [] })
    expect(tx.product.updateMany).not.toHaveBeenCalled()
  })
})

describe('restoreStockForItems', () => {
  it('incrementa el stock en variante o producto según corresponda', async () => {
    const tx = makeTx({ stock: { 'product:p1': 0, 'variant:v1': 0 } })
    await restoreStockForItems(tx, [
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', variantId: 'v1', quantity: 1 },
    ])
    expect(tx.current).toEqual({ 'product:p1': 2, 'variant:v1': 1 })
  })
})
