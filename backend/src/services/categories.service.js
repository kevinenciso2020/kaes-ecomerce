import { prisma } from '../config/prisma.js'
import { generateSlug } from '../utils/slug.utils.js'

const httpError = (status, message) => Object.assign(new Error(message), { status })

export const listCategories = async () =>
  prisma.category.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  })

export const createCategory = async ({ name, description }) => {
  const cleanName = String(name).trim()
  const slug = generateSlug(cleanName)
  const exists = await prisma.category.findFirst({ where: { OR: [{ slug }, { name: { equals: cleanName, mode: 'insensitive' } }] } })
  if (exists) throw httpError(409, `Ya existe la categoría "${exists.name}"`)
  return prisma.category.create({ data: { name: cleanName, slug, description: description || null } })
}

export const updateCategory = async (id, { name, description }) => {
  const category = await prisma.category.findUnique({ where: { id } })
  if (!category) throw httpError(404, 'Categoría no encontrada')
  const data = {}
  if (name && name.trim() !== category.name) {
    data.name = name.trim()
    data.slug = generateSlug(name)
  }
  if (description !== undefined) data.description = description || null
  return prisma.category.update({ where: { id }, data })
}

export const deleteCategory = async (id) => {
  const category = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  })
  if (!category) throw httpError(404, 'Categoría no encontrada')
  if (category._count.products > 0) {
    throw httpError(409, `No se puede eliminar: tiene ${category._count.products} producto(s). Muévelos a otra categoría primero.`)
  }
  await prisma.category.delete({ where: { id } })
  return { id, deleted: true }
}
