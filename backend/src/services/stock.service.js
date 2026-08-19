import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'

const log = logger.child({ component: 'stock' })

export const validateStock = async (orderId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: { product: true }
      }
    }
  })

  if (!order) {
    throw Object.assign(new Error('Orden no encontrada'), { status: 404 })
  }

  const insufficientStock = []

  for (const item of order.items) {
    const product = item.product
    let availableStock = product.stock
    let variantInfo = null

    if (item.size && item.color) {
      const variant = await prisma.productVariant.findFirst({
        where: {
          productId: item.productId,
          size: item.size,
          color: item.color
        }
      })

      if (variant) {
        availableStock = variant.stock
        variantInfo = `variante(${item.size}/${item.color})`
      }
    }

    if (availableStock < item.quantity) {
      insufficientStock.push({
        productId: item.productId,
        productName: product.name,
        requested: item.quantity,
        available: availableStock,
        variant: variantInfo
      })
    }
  }

  if (insufficientStock.length > 0) {
    const messages = insufficientStock.map(
      s => `${s.productName} ${s.variant || ''}: solicitado ${s.requested}, disponible ${s.available}`
    ).join('; ')

    throw Object.assign(new Error(`Stock insuficiente: ${messages}`), {
      status: 400,
      code: 'INSUFFICIENT_STOCK',
      details: insufficientStock
    })
  }

  return { valid: true, order }
}

export const discountStock = async (orderId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } }
  })

  if (!order) {
    throw Object.assign(new Error('Orden no encontrada'), { status: 404 })
  }

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const product = item.product
      let variant = null
      let stockSource = 'product'

      if (item.size && item.color) {
        variant = await tx.productVariant.findFirst({
          where: {
            productId: item.productId,
            size: item.size,
            color: item.color
          }
        })
        stockSource = 'variant'
      }

      if (variant) {
        if (variant.stock < item.quantity) {
          throw Object.assign(new Error(
            `Stock insuficiente: ${product.name} (${item.size}/${item.color}) - disponible: ${variant.stock}, solicitado: ${item.quantity}`
          ), { status: 400, code: 'INSUFFICIENT_STOCK' })
        }
        await tx.productVariant.update({
          where: { id: variant.id },
          data: { stock: { decrement: item.quantity } }
        })
      } else {
        if (product.stock < item.quantity) {
          throw Object.assign(new Error(
            `Stock insuficiente: ${product.name} - disponible: ${product.stock}, solicitado: ${item.quantity}`
          ), { status: 400, code: 'INSUFFICIENT_STOCK' })
        }
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } }
        })
      }
    }

    log.info({ orderId, itemCount: order.items.length }, 'stock.decremented')
  })
}

export const restoreStock = async (orderId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true }
  })

  if (!order) {
    return
  }

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      if (item.size && item.color) {
        const variant = await tx.productVariant.findFirst({
          where: {
            productId: item.productId,
            size: item.size,
            color: item.color
          }
        })

        if (variant) {
          await tx.productVariant.update({
            where: { id: variant.id },
            data: { stock: { increment: item.quantity } }
          })
          continue
        }

        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } }
        })
      } else {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } }
        })
      }
    }

    log.info({ orderId, itemCount: order.items.length }, 'stock.restored')
  })
}