import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { BASIC_COLORS } from '../src/data/basic-colors.js'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed...')
  const isProduction = process.env.NODE_ENV === 'production'

  // Admin inicial: SOLO si se pasan credenciales explícitas por variables de
  // entorno. Nunca se crea un admin con contraseña por defecto.
  //   SEED_ADMIN_EMAIL=tu@correo.com SEED_ADMIN_PASSWORD='…' npm run db:seed
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const adminPassword = process.env.SEED_ADMIN_PASSWORD
  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12 || !/[A-Za-z]/.test(adminPassword) || !/\d/.test(adminPassword)) {
      throw new Error('SEED_ADMIN_PASSWORD debe tener al menos 12 caracteres, letras y números')
    }
    const admin = await prisma.user.upsert({
      where:  { email: adminEmail },
      update: {},
      create: {
        name:          'Administrador',
        email:         adminEmail,
        password:      await bcrypt.hash(adminPassword, 12),
        role:          'SUPER_ADMIN',
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    })
    console.log('✅ Admin inicial:', admin.email, `(${admin.role})`)
  } else {
    console.log('ℹ️  Sin SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD: no se crea admin.')
  }

  for (const [idx, c] of BASIC_COLORS.entries()) {
    await prisma.color.upsert({
      where:  { slug: c.slug },
      update: { hex: c.hex, name: c.name },
      create: { ...c, order: idx + 1 },
    })
  }
  console.log('✅ Colores básicos:', BASIC_COLORS.length)

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

  // Datos de demostración: sólo en desarrollo y si se piden explícitamente.
  if (isProduction || process.env.SEED_DEMO !== 'true') {
    console.log('🎉 Seed completado (sin datos de demostración)')
    return
  }

  const camisetas = await prisma.category.findUnique({ where: { slug: 'camisetas' } })

  await prisma.product.upsert({
    where:  { slug: 'camiseta-basica-blanca' },
    update: {},
    create: {
      name:        'Camiseta Básica Blanca',
      slug:        'camiseta-basica-blanca',
      description: 'Camiseta básica de algodón 100%, perfecta para el día a día.',
      price:       49900,
      stock:       0,
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

  await prisma.coupon.upsert({
    where:  { code: 'TRINITY' },
    update: {},
    create: { code: 'TRINITY', type: 'PERCENTAGE', value: 10, minPurchase: 50000, maxUses: 100, isActive: true },
  })

  console.log('🎉 Seed completado con datos de demostración (desarrollo)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })