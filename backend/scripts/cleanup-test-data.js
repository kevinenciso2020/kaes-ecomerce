import { prisma } from '../src/config/prisma.js'

const TEST_KEYWORDS = ['test', 'prueba', 'sim', 'demo']

const buildNameFilters = () => ({
  OR: TEST_KEYWORDS.flatMap((keyword) => [
    { name: { contains: keyword, mode: 'insensitive' } },
  ]),
})

const findTestProducts = async () => {
  return prisma.product.findMany({
    where: buildNameFilters(),
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  })
}

const main = async () => {
  const confirm = process.argv.includes('--confirm')

  const products = await findTestProducts()

  if (products.length === 0) {
    console.log('No se encontraron productos de prueba.')
    return
  }

  console.log(`Se encontraron ${products.length} producto(s) candidato(s):`)
  console.log('-'.repeat(80))
  for (const p of products) {
    console.log(`  [${p.id}] ${p.name}  (slug: ${p.slug})`)
  }
  console.log('-'.repeat(80))

  if (!confirm) {
    console.log('\nModo dry-run. Para eliminarlos ejecuta:')
    console.log('  node scripts/cleanup-test-data.js --confirm')
    return
  }

  const ids = products.map((p) => p.id)
  const result = await prisma.product.deleteMany({
    where: { id: { in: ids } },
  })

  console.log(`\nEliminados: ${result.count} producto(s).`)
}

main()
  .catch((error) => {
    console.error('Error durante la limpieza:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
