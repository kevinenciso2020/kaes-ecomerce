import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed...')

  // Crear usuario administrador
  const hashedPassword = await bcrypt.hash('admin123', 12)

  const admin = await prisma.user.upsert({
    where:  { email: 'admin@ecommerce.com' },
    update: {},
    create: {
      name:     'Administrador',
      email:    'admin@ecommerce.com',
      password: hashedPassword,
      role:     'ADMIN',
    }
  })

  console.log('✅ Admin creado:', admin.email)

  // Colores canónicos — fuente única de verdad para swatches
  // Los 15 colores base que el admin puede asignar a productos.
  // Si en el futuro se agregan más, se hace por seed o por endpoint admin.
  const colores = [
    { name: 'Negro',         slug: 'negro',         hex: '#000000', order: 1  },
    { name: 'Blanco',        slug: 'blanco',        hex: '#FFFFFF', order: 2  },
    { name: 'Gris',          slug: 'gris',          hex: '#808080', order: 3  },
    { name: 'Azul',          slug: 'azul',          hex: '#1E40FF', order: 4  },
    { name: 'Azul marino',   slug: 'azul-marino',   hex: '#1E3A8A', order: 5  },
    { name: 'Verde',         slug: 'verde',         hex: '#15803D', order: 6  },
    { name: 'Verde militar', slug: 'verde-militar', hex: '#4B5320', order: 7  },
    { name: 'Amarillo',      slug: 'amarillo',      hex: '#FACC15', order: 8  },
    { name: 'Rojo',          slug: 'rojo',          hex: '#DC2626', order: 9  },
    { name: 'Naranja',       slug: 'naranja',       hex: '#F97316', order: 10 },
    { name: 'Rosado',        slug: 'rosado',        hex: '#F472B6', order: 11 },
    { name: 'Morado',        slug: 'morado',        hex: '#7C3AED', order: 12 },
    { name: 'Café',          slug: 'cafe',          hex: '#78350F', order: 13 },
    { name: 'Beige',         slug: 'beige',         hex: '#E7D7B7', order: 14 },
    { name: 'Vinotinto',     slug: 'vinotinto',     hex: '#722F37', order: 15 },
  ]

  for (const c of colores) {
    await prisma.color.upsert({
      where:  { slug: c.slug },
      update: { hex: c.hex, order: c.order, name: c.name },
      create: c,
    })
  }
  console.log('✅ Colores canónicos:', colores.length)

  // Tallas canónicas — LETTER (camisetas), NUMERIC (pantalones), SHOE (zapatos)
  const tallas = [
    // LETTER scale
    { value: 'XS',  scale: 'LETTER',  order: 1  },
    { value: 'S',   scale: 'LETTER',  order: 2  },
    { value: 'M',   scale: 'LETTER',  order: 3  },
    { value: 'L',   scale: 'LETTER',  order: 4  },
    { value: 'XL',  scale: 'LETTER',  order: 5  },
    { value: 'XXL', scale: 'LETTER',  order: 6  },
    // NUMERIC scale (pantalones/jeans)
    { value: '28',  scale: 'NUMERIC', order: 1  },
    { value: '30',  scale: 'NUMERIC', order: 2  },
    { value: '32',  scale: 'NUMERIC', order: 3  },
    { value: '34',  scale: 'NUMERIC', order: 4  },
    { value: '36',  scale: 'NUMERIC', order: 5  },
    { value: '38',  scale: 'NUMERIC', order: 6  },
    // SHOE scale
    { value: '35',  scale: 'SHOE',    order: 1  },
    { value: '36',  scale: 'SHOE',    order: 2  },
    { value: '37',  scale: 'SHOE',    order: 3  },
    { value: '38',  scale: 'SHOE',    order: 4  },
    { value: '39',  scale: 'SHOE',    order: 5  },
    { value: '40',  scale: 'SHOE',    order: 6  },
    { value: '41',  scale: 'SHOE',    order: 7  },
    { value: '42',  scale: 'SHOE',    order: 8  },
    { value: '43',  scale: 'SHOE',    order: 9  },
    { value: '44',  scale: 'SHOE',    order: 10 },
  ]

  for (const t of tallas) {
    await prisma.size.upsert({
      where:  { value: t.value },
      update: { scale: t.scale, order: t.order },
      create: t,
    })
  }
  console.log('✅ Tallas canónicas:', tallas.length)

  // Crear categorías base
  const categorias = [
    { name: 'Camisetas',  slug: 'camisetas',  description: 'Camisetas y tops' },
    { name: 'Pantalones', slug: 'pantalones', description: 'Pantalones y jeans' },
    { name: 'Shorts',     slug: 'shorts',     description: 'Shorts' },
    { name: 'Accesorios', slug: 'accesorios', description: 'Accesorios y complementos' },
    { name: 'Zapatos',    slug: 'zapatos',    description: 'Calzado' },
  ]

  for (const cat of categorias) {
    await prisma.category.upsert({
      where:  { slug: cat.slug },
      update: {},
      create: cat,
    })
  }

  console.log('✅ Categorías creadas:', categorias.length)

  // Crear productos de ejemplo
  const camisetas = await prisma.category.findUnique({ where: { slug: 'camisetas' } })

  await prisma.product.upsert({
    where:  { slug: 'camiseta-basica-blanca' },
    update: {},
    create: {
      name:        'Camiseta Básica Blanca',
      slug:        'camiseta-basica-blanca',
      description: 'Camiseta básica de algodón 100%, perfecta para el día a día.',
      price:       49900,
      stock:       50,
      categoryId:  camisetas.id,
      isFeatured:  true,
      variants: {
        create: [
          { size: 'S',  color: 'Blanco', colorHex: '#FFFFFF', stock: 10 },
          { size: 'M',  color: 'Blanco', colorHex: '#FFFFFF', stock: 20 },
          { size: 'L',  color: 'Blanco', colorHex: '#FFFFFF', stock: 15 },
          { size: 'XL', color: 'Blanco', colorHex: '#FFFFFF', stock: 5  },
        ]
      }
    }
  })

  await prisma.product.upsert({
    where:  { slug: 'camiseta-oversize-negra' },
    update: {},
    create: {
      name:        'Camiseta Oversize Negra',
      slug:        'camiseta-oversize-negra',
      description: 'Camiseta oversize de algodón premium, estilo urbano.',
      price:       65900,
      stock:       30,
      categoryId:  camisetas.id,
      isFeatured:  true,
      variants: {
        create: [
          { size: 'S',  color: 'Negro', colorHex: '#000000', stock: 8  },
          { size: 'M',  color: 'Negro', colorHex: '#000000', stock: 12 },
          { size: 'L',  color: 'Negro', colorHex: '#000000', stock: 10 },
        ]
      }
    }
  })

  console.log('✅ Productos de ejemplo creados')

  // Crear cupón de bienvenida
  await prisma.coupon.upsert({
    where:  { code: 'BIENVENIDO10' },
    update: {},
    create: {
      code:        'BIENVENIDO10',
      type:        'PERCENTAGE',
      value:       10,
      minPurchase: 50000,
      maxUses:     100,
      isActive:    true,
    }
  })

  console.log('✅ Cupón BIENVENIDO10 creado (10% de descuento)')
  console.log('')
  console.log('🎉 Seed completado exitosamente')
  console.log('')
  console.log('📋 Credenciales de admin:')
  console.log('   Email:    admin@ecommerce.com')
  console.log('   Password: admin123')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })