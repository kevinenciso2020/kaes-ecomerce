import { prisma } from '../src/config/prisma.js'

const PRODUCT_KEYWORDS = ['test', 'demo', 'prueba', 'sim']
const USER_EMAIL_PATTERNS = ['test@', 'example.com']

const findTestProducts = async () => {
  return prisma.product.findMany({
    where: {
      OR: PRODUCT_KEYWORDS.map((keyword) => ({
        name: { contains: keyword, mode: 'insensitive' },
      })),
    },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  })
}

const findTestUsers = async () => {
  return prisma.user.findMany({
    where: {
      OR: USER_EMAIL_PATTERNS.map((pattern) => ({
        email: { contains: pattern, mode: 'insensitive' },
      })),
    },
    select: { id: true, email: true, name: true, role: true },
    orderBy: { email: 'asc' },
  })
}

const printSection = (title, rows, formatter) => {
  if (rows.length === 0) {
    console.log(`\n${title}: 0 coincidencias.`)
    return
  }

  console.log(`\n${title}: ${rows.length} candidato(s)`)
  console.log('-'.repeat(80))
  for (const row of rows) console.log(`  ${formatter(row)}`)
  console.log('-'.repeat(80))
}

const main = async () => {
  const confirm = process.argv.includes('--confirm')

  const [products, users] = await Promise.all([findTestProducts(), findTestUsers()])

  console.log('=== Limpieza de datos de prueba ===')
  console.log(`Productos (keywords: ${PRODUCT_KEYWORDS.join(', ')})`)
  console.log(`Usuarios   (patrones: ${USER_EMAIL_PATTERNS.join(', ')})`)

  printSection(
    'Productos',
    products,
    (p) => `[${p.id}] ${p.name}  (slug: ${p.slug})`,
  )

  printSection(
    'Usuarios',
    users,
    (u) => `[${u.id}] ${u.email}  (${u.name} · ${u.role})`,
  )

  if (!confirm) {
    console.log('\nModo dry-run. Para eliminarlos ejecuta:')
    console.log('  npm run cleanup:test-data -- --confirm')
    return
  }

  console.log('\nEliminando...')

  let deletedProducts = 0
  if (products.length > 0) {
    const result = await prisma.product.deleteMany({
      where: { id: { in: products.map((p) => p.id) } },
    })
    deletedProducts = result.count
    console.log(`  Productos eliminados: ${deletedProducts}`)
  }

  let deletedUsers = 0
  if (users.length > 0) {
    const result = await prisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    })
    deletedUsers = result.count
    console.log(`  Usuarios eliminados:   ${deletedUsers}`)
  }

  console.log('\nResumen:')
  console.log(`  Productos: ${deletedProducts}/${products.length}`)
  console.log(`  Usuarios:  ${deletedUsers}/${users.length}`)
}

main()
  .catch((error) => {
    console.error('Error durante la limpieza:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
