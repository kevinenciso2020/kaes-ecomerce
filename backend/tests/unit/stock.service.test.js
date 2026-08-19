import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    order: { findUnique: vi.fn() },
    product: { update: vi.fn() },
    productVariant: { findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '../../src/config/prisma.js'
import {
  discountStock,
  validateStock,
  restoreStock,
} from '../../src/services/stock.service.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const orderWithItems = (items) => ({
  id: 'ord-1',
  items: items.map((it, idx) => ({
    id: `item-${idx}`,
    productId: it.productId,
    quantity: it.quantity,
    size: it.size || null,
    color: it.color || null,
    product: {
      id: it.productId,
      name: it.name || `Product ${it.productId}`,
      stock: it.productStock ?? 100,
    },
  })),
})

const setupTx = ({ variantMap = {}, updatedProducts = [], updatedVariants = [] } = {}) => {
  const tx = {
    productVariant: {
      findFirst: vi.fn(async ({ where }) => {
        const key = `${where.productId}|${where.size}|${where.color}`
        return variantMap[key] || null
      }),
      update: vi.fn(async ({ where, data }) => {
        updatedVariants.push({ id: where.id, data })
        return { id: where.id, ...data }
      }),
    },
    product: {
      update: vi.fn(async ({ where, data }) => {
        updatedProducts.push({ id: where.id, data })
        return { id: where.id, ...data }
      }),
    },
  }
  prisma.$transaction.mockImplementation(async (cb) => cb(tx))
  return tx
}

describe('discountStock — happy paths', () => {
  it('descuenta stock del Product cuando el item NO tiene size/color', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(
      orderWithItems([{ productId: 'p1', quantity: 2, productStock: 10 }]),
    )
    const updatedProducts = []
    setupTx({ updatedProducts })

    await discountStock('ord-1')

    expect(updatedProducts).toHaveLength(1)
    expect(updatedProducts[0]).toEqual({
      id: 'p1',
      data: { stock: { decrement: 2 } },
    })
  })

  it('descuenta stock del ProductVariant cuando hay size+color', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(
      orderWithItems([
        { productId: 'p1', quantity: 3, size: 'M', color: 'azul', productStock: 100 },
      ]),
    )
    const updatedVariants = []
    setupTx({
      variantMap: { 'p1|M|azul': { id: 'v-1', stock: 10 } },
      updatedVariants,
    })

    await discountStock('ord-1')

    expect(updatedVariants).toHaveLength(1)
    expect(updatedVariants[0]).toEqual({
      id: 'v-1',
      data: { stock: { decrement: 3 } },
    })
  })

  it('maneja orden mixta (algunos con variant, otros sin) en una transacción', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(
      orderWithItems([
        { productId: 'p1', quantity: 1, size: 'S', color: 'rojo', productStock: 50 },
        { productId: 'p2', quantity: 4, productStock: 10 },
      ]),
    )
    const updatedProducts = []
    const updatedVariants = []
    setupTx({
      variantMap: { 'p1|S|rojo': { id: 'v-1', stock: 5 } },
      updatedProducts,
      updatedVariants,
    })

    await discountStock('ord-1')

    expect(updatedVariants).toHaveLength(1)
    expect(updatedVariants[0].data.stock.decrement).toBe(1)
    expect(updatedProducts).toHaveLength(1)
    expect(updatedProducts[0]).toEqual({ id: 'p2', data: { stock: { decrement: 4 } } })
  })

  it('no hace nada si la orden tiene 0 items (no rompe)', async () => {
    prisma.order.findUnique.mockResolvedValueOnce({ id: 'ord-empty', items: [] })
    const updatedProducts = []
    const updatedVariants = []
    setupTx({ updatedProducts, updatedVariants })

    await expect(discountStock('ord-empty')).resolves.toBeUndefined()
    expect(updatedProducts).toHaveLength(0)
    expect(updatedVariants).toHaveLength(0)
  })
})

describe('discountStock — errores', () => {
  it('lanza 404 si la orden no existe', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(null)

    await expect(discountStock('missing')).rejects.toMatchObject({
      status: 404,
      message: expect.stringMatching(/Orden no encontrada/i),
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lanza INSUFFICIENT_STOCK si variant.stock < quantity', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(
      orderWithItems([
        { productId: 'p1', quantity: 5, size: 'L', color: 'negro', productStock: 100 },
      ]),
    )
    const updatedVariants = []
    setupTx({
      variantMap: { 'p1|L|negro': { id: 'v-1', stock: 2 } },
      updatedVariants,
    })

    await expect(discountStock('ord-1')).rejects.toMatchObject({
      status: 400,
      code: 'INSUFFICIENT_STOCK',
    })
    expect(updatedVariants).toHaveLength(0)
  })

  it('lanza INSUFFICIENT_STOCK si product.stock < quantity', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(
      orderWithItems([{ productId: 'p1', quantity: 10, productStock: 3 }]),
    )
    const updatedProducts = []
    setupTx({ updatedProducts })

    await expect(discountStock('ord-1')).rejects.toMatchObject({
      status: 400,
      code: 'INSUFFICIENT_STOCK',
    })
    expect(updatedProducts).toHaveLength(0)
  })
})

describe('validateStock', () => {
  it('devuelve { valid: true, order } cuando todo el stock alcanza', async () => {
    const order = orderWithItems([
      { productId: 'p1', quantity: 2, productStock: 10 },
      { productId: 'p2', quantity: 1, size: 'M', color: 'azul', productStock: 50 },
    ])
    prisma.order.findUnique.mockResolvedValueOnce(order)
    prisma.productVariant.findFirst.mockResolvedValueOnce({ stock: 7 })

    const result = await validateStock('ord-1')
    expect(result.valid).toBe(true)
    expect(result.order).toBe(order)
  })

  it('acumula TODOS los productos con stock insuficiente en details', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(
      orderWithItems([
        { productId: 'p1', quantity: 10, productStock: 2, name: 'Camiseta A' },
        { productId: 'p2', quantity: 5, productStock: 1, name: 'Pantalón B' },
      ]),
    )

    await expect(validateStock('ord-1')).rejects.toMatchObject({
      status: 400,
      code: 'INSUFFICIENT_STOCK',
      details: expect.arrayContaining([
        expect.objectContaining({ productId: 'p1', requested: 10, available: 2 }),
        expect.objectContaining({ productId: 'p2', requested: 5, available: 1 }),
      ]),
    })
  })

  it('incluye info de variant cuando el item tiene size+color', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(
      orderWithItems([
        { productId: 'p1', quantity: 5, size: 'M', color: 'rojo', productStock: 50, name: 'Polo X' },
      ]),
    )
    prisma.productVariant.findFirst.mockResolvedValueOnce({ stock: 1 })

    await expect(validateStock('ord-1')).rejects.toMatchObject({
      status: 400,
      code: 'INSUFFICIENT_STOCK',
      details: expect.arrayContaining([
        expect.objectContaining({
          productId: 'p1',
          available: 1,
          variant: expect.stringMatching(/M.*rojo/),
        }),
      ]),
    })
  })

  it('lanza 404 si la orden no existe', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(null)

    await expect(validateStock('missing')).rejects.toMatchObject({ status: 404 })
  })
})

describe('restoreStock', () => {
  it('incrementa stock del ProductVariant cuando hay size+color', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(
      orderWithItems([
        { productId: 'p1', quantity: 2, size: 'M', color: 'azul' },
      ]),
    )
    const updatedVariants = []
    setupTx({
      variantMap: { 'p1|M|azul': { id: 'v-1' } },
      updatedVariants,
    })

    await restoreStock('ord-1')

    expect(updatedVariants).toHaveLength(1)
    expect(updatedVariants[0]).toEqual({
      id: 'v-1',
      data: { stock: { increment: 2 } },
    })
  })

  it('incrementa stock del Product cuando el item NO tiene size/color', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(
      orderWithItems([{ productId: 'p1', quantity: 3 }]),
    )
    const updatedProducts = []
    setupTx({ updatedProducts })

    await restoreStock('ord-1')

    expect(updatedProducts).toHaveLength(1)
    expect(updatedProducts[0]).toEqual({
      id: 'p1',
      data: { stock: { increment: 3 } },
    })
  })

  it('hace fallback a Product si no encuentra variant con size+color', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(
      orderWithItems([{ productId: 'p1', quantity: 1, size: 'XL', color: 'verde' }]),
    )
    const updatedProducts = []
    const updatedVariants = []
    setupTx({
      variantMap: {},
      updatedProducts,
      updatedVariants,
    })

    await restoreStock('ord-1')

    expect(updatedVariants).toHaveLength(0)
    expect(updatedProducts).toHaveLength(1)
    expect(updatedProducts[0]).toEqual({
      id: 'p1',
      data: { stock: { increment: 1 } },
    })
  })

  it('no lanza error si la orden no existe (silent fail)', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(null)

    await expect(restoreStock('ghost')).resolves.toBeUndefined()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
