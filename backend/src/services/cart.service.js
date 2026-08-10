import { prisma } from '../config/prisma.js'

export const getCart = async (userId) => {
  const items = await prisma.cartItem.findMany({
    where:   { userId },
    include: {
      product: {
        include: { images: { where: { isMain: true }, take: 1 } }
      }
    }
  })

  const total = items.reduce((sum, item) =>
    sum + (parseFloat(item.product.price) * item.quantity), 0
  )

  return { items, total: total.toFixed(2), count: items.length }
}

export const addToCart = async (userId, { productId, quantity = 1, size, color }) => {
  const product = await prisma.product.findFirst({ where: { id: productId, isActive: true } })
  if (!product) {
    const err = new Error('Producto no encontrado')
    err.status = 404
    throw err
  }

  // Si ya existe el mismo producto con la misma talla y color, sumamos la cantidad
  const existing = await prisma.cartItem.findFirst({
    where: { userId, productId, size: size || null, color: color || null }
  })

  if (existing) {
    return prisma.cartItem.update({
      where: { id: existing.id },
      data:  { quantity: existing.quantity + quantity }
    })
  }

  return prisma.cartItem.create({
    data: { userId, productId, quantity, size, color }
  })
}

export const updateCartItem = async (userId, itemId, quantity) => {
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, userId } })
  if (!item) {
    const err = new Error('Item no encontrado en el carrito')
    err.status = 404
    throw err
  }

  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: itemId } })
    return { message: 'Item eliminado del carrito' }
  }

  return prisma.cartItem.update({ where: { id: itemId }, data: { quantity } })
}

export const removeFromCart = async (userId, itemId) => {
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, userId } })
  if (!item) {
    const err = new Error('Item no encontrado')
    err.status = 404
    throw err
  }
  await prisma.cartItem.delete({ where: { id: itemId } })
  return { message: 'Item eliminado del carrito' }
}

export const clearCart = async (userId) => {
  await prisma.cartItem.deleteMany({ where: { userId } })
  return { message: 'Carrito vaciado' }
}