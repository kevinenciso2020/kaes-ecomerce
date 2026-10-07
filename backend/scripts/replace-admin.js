// Reemplaza al administrador de la tienda.
//
//   NEW_ADMIN_EMAIL=nuevo@correo.com NEW_ADMIN_PASSWORD='…' npm run admin:replace              → simulación
//   NEW_ADMIN_EMAIL=nuevo@correo.com NEW_ADMIN_PASSWORD='…' npm run admin:replace -- --confirm → aplica
//
// Qué hace:
//  • Crea (o actualiza) al nuevo usuario como SUPER_ADMIN con el email verificado.
//  • Elimina a los demás ADMIN/SUPER_ADMIN y cierra sus sesiones. Si alguno tiene
//    órdenes (o no se puede borrar) se desactiva y se degrada a CUSTOMER.
// La contraseña se lee del entorno: nunca se guarda en el repositorio.

import bcrypt from 'bcryptjs'
import { prisma } from '../src/config/prisma.js'

const confirm = process.argv.includes('--confirm')
const email = process.env.NEW_ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.NEW_ADMIN_PASSWORD

const main = async () => {
  if (!email || !password) {
    throw new Error('Define NEW_ADMIN_EMAIL y NEW_ADMIN_PASSWORD en el entorno')
  }
  console.log(`=== Reemplazo de administrador (${confirm ? 'APLICANDO' : 'SIMULACIÓN'}) ===`)

  const others = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, email: { not: email } },
    include: { _count: { select: { orders: true } } },
  })
  const existing = await prisma.user.findUnique({ where: { email } })
  console.log(`Nuevo admin: ${email} (${existing ? 'existe, se actualiza' : 'se crea'})`)
  for (const u of others) {
    console.log(`  [${u._count.orders > 0 ? 'DESACTIVAR' : 'ELIMINAR'}] ${u.role} ${u.email}`)
  }

  if (!confirm) {
    console.log('\nModo simulación. Agrega -- --confirm para aplicar.')
    return
  }

  const hash = await bcrypt.hash(password, 12)
  const admin = await prisma.user.upsert({
    where: { email },
    update: { password: hash, role: 'SUPER_ADMIN', isActive: true, emailVerified: true, emailVerifiedAt: new Date() },
    create: {
      name: 'Administrador',
      email,
      password: hash,
      role: 'SUPER_ADMIN',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  })
  await prisma.refreshToken.deleteMany({ where: { userId: admin.id } })

  for (const u of others) {
    await prisma.refreshToken.deleteMany({ where: { userId: u.id } })
    try {
      if (u._count.orders > 0) throw new Error('tiene órdenes')
      await prisma.user.delete({ where: { id: u.id } })
      console.log(`  Eliminado: ${u.email}`)
    } catch {
      await prisma.user.update({ where: { id: u.id }, data: { isActive: false, role: 'CUSTOMER' } })
      console.log(`  Desactivado y degradado a CUSTOMER: ${u.email}`)
    }
  }
  console.log(`\n✅ Admin listo: ${admin.email} (${admin.role})`)
}

main()
  .catch((error) => {
    console.error('Error:', error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
