import { prisma } from '../config/prisma.js'
import { generateSlug } from '../utils/slug.utils.js'

const httpError = (status, message) => Object.assign(new Error(message), { status })

export const listColors = async () => {
  return prisma.color.findMany({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  })
}

export const getColorBySlug = async (slug) => {
  return prisma.color.findUnique({ where: { slug } })
}

export const createColor = async ({ name, hex }) => {
  const cleanName = String(name).trim()
  const slug = generateSlug(cleanName)
  const exists = await prisma.color.findFirst({ where: { OR: [{ slug }, { name: { equals: cleanName, mode: 'insensitive' } }] } })
  if (exists) throw httpError(409, `Ya existe el color "${exists.name}"`)
  const last = await prisma.color.aggregate({ _max: { order: true } })
  return prisma.color.create({
    data: { name: cleanName, slug, hex: String(hex).toUpperCase(), order: (last._max.order ?? 0) + 1 },
  })
}

export const updateColor = async (id, { name, hex }) => {
  const color = await prisma.color.findUnique({ where: { id } })
  if (!color) throw httpError(404, 'Color no encontrado')
  const data = {}
  if (hex) data.hex = String(hex).toUpperCase()
  if (name && name.trim() !== color.name) {
    // El nombre del color se guarda en las variantes: renombrarlo aquí no
    // actualiza productos existentes, así que sólo se permite si no se usa.
    const used = await prisma.productVariant.count({ where: { color: color.name } })
    if (used > 0) throw httpError(409, `No se puede renombrar: ${used} variante(s) usan "${color.name}". Crea un color nuevo.`)
    data.name = name.trim()
    data.slug = generateSlug(name)
  }
  const updated = await prisma.color.update({ where: { id }, data })
  if (data.hex) {
    await prisma.productVariant.updateMany({ where: { color: updated.name }, data: { colorHex: data.hex } })
  }
  return updated
}

export const deleteColor = async (id) => {
  const color = await prisma.color.findUnique({ where: { id } })
  if (!color) throw httpError(404, 'Color no encontrado')
  const used = await prisma.productVariant.count({ where: { color: color.name } })
  if (used > 0) throw httpError(409, `No se puede eliminar: ${used} variante(s) usan "${color.name}"`)
  await prisma.color.delete({ where: { id } })
  return { id, deleted: true }
}
