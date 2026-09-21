// Limpieza de datos de prueba antes del lanzamiento.
//
//   npm run cleanup:test-data              → modo simulación (sólo muestra)
//   npm run cleanup:test-data -- --confirm → aplica los cambios
//
// Qué hace:
//  • Elimina el admin por defecto del seed antiguo (admin@ecommerce.com / admin123)
//    y cierra sus sesiones.
//  • Productos cuyo nombre o descripción contiene palabras de prueba:
//      - sin ventas → se eliminan (con sus imágenes en Cloudinary)
//      - con ventas → se ARCHIVAN (isActive=false) para no romper el historial
//  • Usuarios de prueba (test@…, @example.com) sin órdenes → se eliminan;
//    con órdenes → se desactivan.
//  • Productos con precio menor a MIN_REAL_PRICE (default $1.000) se listan
//    como sospechosos (no se tocan automáticamente).

import { prisma } from '../src/config/prisma.js'
import { destroyImages } from '../src/utils/cloudinary.utils.js'

const TEST_WORDS = ['test', 'prueba', 'demo', 'piledriver', 'neon dream', 'sim test']
const DEFAULT_ADMIN_EMAIL = 'admin@ecommerce.com'
const USER_PATTERNS = ['test@', '@example.com', '@test.com']
const MIN_REAL_PRICE = Number(process.env.MIN_REAL_PRICE || 1000)

const confirm = process.argv.includes('--confirm')

const line = () => console.log('-'.repeat(80))

const main = async () => {
  console.log(`=== Limpieza de datos de prueba (${confirm ? 'APLICANDO' : 'SIMULACIÓN'}) ===`)

  // ── Admin por defecto ─────────────────────────────────────
  const defaultAdmin = await prisma.user.findUnique({
    where: { email: DEFAULT_ADMIN_EMAIL },
    include: { _count: { select: { orders: true } } },
  })
  console.log(`\nAdmin por defecto (${DEFAULT_ADMIN_EMAIL}): ${defaultAdmin ? `EXISTE (rol ${defaultAdmin.role}) ⚠️` : 'no existe ✅'}`)

  // ── Productos de prueba ───────────────────────────────────
  const testProducts = await prisma.product.findMany({
    where: {
      OR: TEST_WORDS.flatMap((w) => [
        { name: { contains: w, mode: 'insensitive' } },
        { description: { contains: w, mode: 'insensitive' } },
      ]),
    },
    include: { images: true, _count: { select: { orderItems: true } } },
    orderBy: { name: 'asc' },
  })
  console.log(`\nProductos de prueba: ${testProducts.length}`)
  line()
  for (const p of testProducts) {
    const action = p._count.orderItems > 0 ? 'ARCHIVAR (tiene ventas)' : 'ELIMINAR'
    console.log(`  [${action}] ${p.name}  $${p.price}  (${p.slug})`)
  }
  line()

  const cheap = await prisma.product.findMany({
    where: { price: { lt: MIN_REAL_PRICE }, id: { notIn: testProducts.map((p) => p.id) } },
    select: { name: true, price: true, slug: true, isActive: true },
  })
  if (cheap.length) {
    console.log(`\nProductos con precio < $${MIN_REAL_PRICE} (revisar manualmente, NO se tocan):`)
    for (const p of cheap) console.log(`  ${p.name}  $${p.price}  (${p.slug})${p.isActive ? '' : ' [inactivo]'}`)
  }

  // ── Usuarios de prueba ────────────────────────────────────
  const testUsers = await prisma.user.findMany({
    where: {
      email: { not: DEFAULT_ADMIN_EMAIL },
      role: 'CUSTOMER',
      OR: USER_PATTERNS.map((pattern) => ({ email: { contains: pattern, mode: 'insensitive' } })),
    },
    include: { _count: { select: { orders: true } } },
  })
  console.log(`\nUsuarios de prueba: ${testUsers.length}`)
  for (const u of testUsers) {
    console.log(`  [${u._count.orders > 0 ? 'DESACTIVAR' : 'ELIMINAR'}] ${u.email}`)
  }

  const admins = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    select: { email: true, role: true, isActive: true },
  })
  console.log('\nAdministradores actuales (verifica que todos sean conocidos):')
  for (const a of admins) console.log(`  ${a.role.padEnd(11)} ${a.email}${a.isActive ? '' : ' [inactivo]'}`)

  if (!confirm) {
    console.log('\nModo simulación. Para aplicar: npm run cleanup:test-data -- --confirm')
    return
  }

  // ── Aplicar ───────────────────────────────────────────────
  if (defaultAdmin) {
    await prisma.refreshToken.deleteMany({ where: { userId: defaultAdmin.id } })
    if (defaultAdmin._count.orders > 0) {
      await prisma.user.update({ where: { id: defaultAdmin.id }, data: { isActive: false, role: 'CUSTOMER' } })
      console.log('  Admin por defecto: desactivado y degradado a CUSTOMER (tenía órdenes)')
    } else {
      await prisma.user.delete({ where: { id: defaultAdmin.id } })
      console.log('  Admin por defecto: eliminado')
    }
  }

  for (const p of testProducts) {
    if (p._count.orderItems > 0) {
      await prisma.product.update({ where: { id: p.id }, data: { isActive: false, isFeatured: false } })
    } else {
      await prisma.$transaction([
        prisma.cartItem.deleteMany({ where: { productId: p.id } }),
        prisma.product.delete({ where: { id: p.id } }),
      ])
      await destroyImages(p.images.map((img) => img.publicId))
    }
  }
  console.log(`  Productos procesados: ${testProducts.length}`)

  for (const u of testUsers) {
    if (u._count.orders > 0) {
      await prisma.user.update({ where: { id: u.id }, data: { isActive: false } })
      await prisma.refreshToken.deleteMany({ where: { userId: u.id } })
    } else {
      await prisma.user.delete({ where: { id: u.id } })
    }
  }
  console.log(`  Usuarios procesados: ${testUsers.length}`)
  console.log('\n✅ Limpieza aplicada. Si el admin por defecto existía, rota JWT_SECRET y JWT_REFRESH_SECRET.')
}

main()
  .catch((error) => {
    console.error('Error durante la limpieza:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
