import { prisma } from '../config/prisma.js'

export const listSizes = async ({ scale } = {}) => {
  const where = scale ? { scale } : {}
  return prisma.size.findMany({
    where,
    orderBy: [{ scale: 'asc' }, { order: 'asc' }],
  })
}

export const getSizeByValue = async (value) => {
  return prisma.size.findUnique({ where: { value } })
}
