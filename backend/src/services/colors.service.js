import { prisma } from '../config/prisma.js'

export const listColors = async () => {
  return prisma.color.findMany({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  })
}

export const getColorBySlug = async (slug) => {
  return prisma.color.findUnique({ where: { slug } })
}
