import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../src/config/prisma.js', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    product: {
      findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
    },
    productImage: {
      findFirst: vi.fn(), findMany: vi.fn(),
      create: vi.fn(), createMany: vi.fn(),
      update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(),
    },
    productVariant: {
      findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(),
      createMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(), create: vi.fn(), update: vi.fn(),
    },
    productAvailableSize: { deleteMany: vi.fn(), createMany: vi.fn() },
    category: { findUnique: vi.fn(), findMany: vi.fn() },
    taxSetting: { findUnique: vi.fn() },
    color: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), aggregate: vi.fn(), delete: vi.fn() },
    size: { findMany: vi.fn(), findUnique: vi.fn() },
    orderItem: { count: vi.fn() },
    cartItem: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}))

vi.mock('../../src/config/cloudinary.js', () => ({
  default: {
    uploader: {
      upload:  vi.fn(),
      destroy: vi.fn(),
    },
  },
}))

vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

import request from 'supertest'
import app from '../../src/app.js'
import { prisma } from '../../src/config/prisma.js'
import cloudinary from '../../src/config/cloudinary.js'

const adminToken = () =>
  jwt.sign({ id: 'a1', email: 'admin@a.com', role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '15m' })

beforeEach(() => {
  // resetAllMocks borra calls, results, queue de mockResolvedValueOnce
  // y deja las implementaciones persistentes (mockResolvedValue, mockReturnValue) intactas.
  vi.resetAllMocks()
  // isAdmin confirma en BD que el admin sigue activo y con el mismo rol.
  prisma.user.findFirst.mockResolvedValue({ id: 'admin' })
  cloudinary.uploader.upload.mockResolvedValue({ secure_url: 'https://x/y.jpg', public_id: 'pid' })
  cloudinary.uploader.destroy.mockResolvedValue({ result: 'ok' })
  prisma.taxSetting.findUnique.mockResolvedValue({ id: 1, rate: 19 })
})

describe('GET /api/v1/admin/colors', () => {
  it('returns the canonical color list', async () => {
    prisma.color.findMany.mockResolvedValueOnce([
      { id: 'c1', name: 'Negro', slug: 'negro', hex: '#000', order: 1 },
      { id: 'c2', name: 'Blanco', slug: 'blanco', hex: '#FFF', order: 2 },
    ])
    const res = await request(app)
      .get('/api/v1/admin/colors')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toMatchObject({ slug: 'negro' })
  })

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/colors')
    expect(res.status).toBe(401)
  })

  it('returns 403 for CUSTOMER role', async () => {
    const token = jwt.sign({ id: 'u1', role: 'CUSTOMER' }, process.env.JWT_SECRET)
    const res = await request(app).get('/api/v1/admin/colors').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/admin/sizes', () => {
  it('returns sizes filtered by scale when ?scale=LETTER', async () => {
    prisma.size.findMany.mockResolvedValueOnce([
      { id: 's1', value: 'M', scale: 'LETTER', order: 3 },
    ])
    const res = await request(app)
      .get('/api/v1/admin/sizes?scale=LETTER')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(prisma.size.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scale: 'LETTER' } }),
    )
  })

  it('rejects invalid scale', async () => {
    const res = await request(app)
      .get('/api/v1/admin/sizes?scale=BOGUS')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/admin/products (admin list)', () => {
  it('returns products with pagination shape', async () => {
    prisma.product.findMany.mockResolvedValueOnce([
      { id: 'p1', name: 'X', slug: 'x', price: 100, stock: 5, lowStockThreshold: 5,
        isActive: true, isFeatured: false, variants: [{ stock: 1, lowStockThreshold: 5 }] },
    ])
    prisma.product.count.mockResolvedValueOnce(1)

    const res = await request(app)
      .get('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      products: expect.any(Array),
      total: 1,
      page: 1,
      totalPages: 1,
    })
    expect(res.body.products[0]).toMatchObject({
      id: 'p1',
      totalStock: 1,
      lowStockCount: 1,
    })
  })

  it('rejects invalid isActive value', async () => {
    const res = await request(app)
      .get('/api/v1/admin/products?isActive=bogus')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('returns 403 for non-admin', async () => {
    const token = jwt.sign({ id: 'u1', role: 'CUSTOMER' }, process.env.JWT_SECRET)
    const res = await request(app)
      .get('/api/v1/admin/products')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/admin/products/:id', () => {
  it('returns the product with full includes', async () => {
    prisma.product.findUnique.mockResolvedValueOnce({
      id: 'p1', name: 'X', slug: 'x', price: 100,
      category: { id: 'cat1', name: 'Cat' },
      images: [], variants: [], availableSizes: [],
      discounts: [],
    })

    const res = await request(app)
      .get('/api/v1/admin/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('p1')
  })

  it('returns 404 when not found', async () => {
    prisma.product.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .get('/api/v1/admin/products/ghost')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/admin/products/:id/images/:imageId', () => {
  it('deletes an image and calls cloudinary.destroy', async () => {
    prisma.productImage.findFirst.mockResolvedValueOnce({
      id: 'img1', publicId: 'pid1', isMain: false, productId: 'p1',
    })
    prisma.productImage.delete.mockResolvedValueOnce({ id: 'img1' })
    prisma.productImage.findFirst.mockResolvedValueOnce(null)

    const res = await request(app)
      .delete('/api/v1/admin/products/p1/images/img1')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ deleted: true, imageId: 'img1' })
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('pid1')
  })

  it('returns 404 when image does not belong to product', async () => {
    prisma.productImage.findFirst.mockResolvedValueOnce(null)
    const res = await request(app)
      .delete('/api/v1/admin/products/p1/images/img-ghost')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/admin/products/:id/images/:imageId/main', () => {
  it('marks the image as main within a transaction', async () => {
    prisma.productImage.findFirst.mockResolvedValueOnce({
      id: 'img2', productId: 'p1', isMain: false,
    })
    prisma.$transaction.mockResolvedValueOnce([{ count: 3 }, { id: 'img2' }])
    prisma.product.findUnique.mockResolvedValueOnce({
      id: 'p1', name: 'X', variants: [], images: [], category: null, availableSizes: [], discounts: [],
    })

    const res = await request(app)
      .patch('/api/v1/admin/products/p1/images/img2/main')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/admin/products/:id', () => {
  it('por defecto ARCHIVA (isActive=false) y conserva las imágenes', async () => {
    prisma.product.findUnique.mockResolvedValueOnce({
      id: 'p1', isActive: true,
      images: [{ id: 'i1', publicId: 'pid1' }],
      _count: { orderItems: 3 },
    })
    prisma.product.update.mockResolvedValueOnce({ id: 'p1', isActive: false })

    const res = await request(app)
      .delete('/api/v1/admin/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 'p1', archived: true })
    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isActive: false } })
    // Los pedidos antiguos siguen mostrando la foto
    expect(cloudinary.uploader.destroy).not.toHaveBeenCalled()
  })

  it('hard=true elimina definitivamente y borra las imágenes si nunca se vendió', async () => {
    prisma.product.findUnique.mockResolvedValueOnce({
      id: 'p1', images: [{ id: 'i1', publicId: 'pid1' }, { id: 'i2', publicId: 'pid2' }],
      _count: { orderItems: 0 },
    })
    prisma.$transaction.mockResolvedValueOnce([])

    const res = await request(app)
      .delete('/api/v1/admin/products/p1?hard=true')
      .set('Authorization', `Bearer ${adminToken()}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 'p1', deleted: true })
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('pid1')
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('pid2')
  })

  it('hard=true responde 409 si el producto tiene ventas', async () => {
    prisma.product.findUnique.mockResolvedValueOnce({ id: 'p1', images: [], _count: { orderItems: 2 } })
    const res = await request(app)
      .delete('/api/v1/admin/products/p1?hard=true')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(409)
    expect(prisma.product.delete).not.toHaveBeenCalled()
  })

  it('returns 404 when product does not exist', async () => {
    prisma.product.findUnique.mockResolvedValueOnce(null)
    const res = await request(app)
      .delete('/api/v1/admin/products/nope')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/admin/products — imágenes por URL de Cloudinary', () => {
  const setupCreate = () => {
    prisma.category.findUnique.mockResolvedValue({ id: 'cat1' })
    prisma.product.findUnique
      .mockResolvedValueOnce(null) // slug libre
      .mockResolvedValue({ id: 'p-new', name: 'Camiseta', images: [], variants: [], availableSizes: [], discounts: [] })
    prisma.product.create.mockResolvedValueOnce({ id: 'p-new' })
    prisma.$transaction.mockImplementation(async (cb) => cb(prisma))
  }

  it('guarda price = base + IVA (19 %) y la tasa usada', async () => {
    setupCreate()
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Camiseta', basePrice: '20000', categorySlug: 'camisetas' })
    expect(res.status).toBe(201)
    const data = prisma.product.create.mock.calls[0][0].data
    expect(data.basePrice).toBe(20000)
    expect(data.taxRate).toBe(19)
    expect(data.price).toBe(23800)
  })

  it('producto exento: taxRate 0 → price = base', async () => {
    setupCreate()
    await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Libro', basePrice: '45000', taxRate: '0', categorySlug: 'camisetas' })
    const data = prisma.product.create.mock.calls[0][0].data
    expect(data.taxRate).toBe(0)
    expect(data.price).toBe(45000)
  })

  it('variante con precio propio: calcula su price con la tasa del producto', async () => {
    setupCreate()
    await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        name: 'Camiseta', basePrice: '20000', categorySlug: 'camisetas',
        variants: JSON.stringify([{ size: 'M', color: 'Azul', stock: 3, basePrice: 30000 }, { size: 'L', color: 'Azul', stock: 1 }]),
      })
    const v = prisma.product.create.mock.calls[0][0].data.variants.create
    expect(v[0]).toMatchObject({ basePrice: 30000, price: 35700 })
    expect(v[1]).toMatchObject({ basePrice: null, price: null })
  })

  it('rechaza la tasa fuera de 0–30', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'X', basePrice: 1000, taxRate: 45, categorySlug: 'camisetas' })
    expect(res.status).toBe(400)
  })

  it('crea el producto con las URLs de Cloudinary como imágenes (la primera es la principal)', async () => {
    setupCreate()
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      // (multer está mockeado en los tests; el form llega como JSON)
      .send({
        name: 'Camiseta', basePrice: '59900', categorySlug: 'camisetas',
        imageUrls: JSON.stringify([
          'https://res.cloudinary.com/test_cloud/image/upload/v1/ecommerce-ropa/products/a.jpg',
          'https://res.cloudinary.com/test_cloud/image/upload/w_800,c_fill/b.png',
        ]),
      })

    expect(res.status).toBe(201)
    const data = prisma.product.create.mock.calls[0][0].data
    expect(data.images.create).toEqual([
      expect.objectContaining({ url: expect.stringContaining('/a.jpg'), publicId: 'ecommerce-ropa/products/a', isMain: true, order: 0 }),
      expect.objectContaining({ url: expect.stringContaining('/b.png'), publicId: 'b', isMain: false, order: 1 }),
    ])
    expect(cloudinary.uploader.upload).not.toHaveBeenCalled()
  })

  it('rechaza URLs http o de hosts privados', async () => {
    prisma.category.findUnique.mockResolvedValue({ id: 'cat1' })
    for (const bad of ['http://evil.example.com/x.jpg', 'https://127.0.0.1/x.jpg', 'https://localhost/x.jpg']) {
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ name: 'Camiseta', basePrice: '59900', categorySlug: 'camisetas', imageUrls: JSON.stringify([bad]) })
      expect(res.status).toBe(400)
    }
    expect(prisma.product.create).not.toHaveBeenCalled()
    expect(cloudinary.uploader.upload).not.toHaveBeenCalled()
  })

  it('pide a Cloudinary que cargue una URL https externa', async () => {
    prisma.category.findUnique.mockResolvedValue({ id: 'cat1' })
    cloudinary.uploader.upload.mockResolvedValue({ secure_url: 'https://res.cloudinary.com/demo/image/upload/ecommerce-ropa/products/x.jpg', public_id: 'ecommerce-ropa/products/x' })
    await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Camiseta', basePrice: '59900', categorySlug: 'camisetas', imageUrls: JSON.stringify(['https://cdn.ejemplo.com/foto.jpg']) })
    expect(cloudinary.uploader.upload).toHaveBeenCalledWith('https://cdn.ejemplo.com/foto.jpg', expect.objectContaining({ folder: 'ecommerce-ropa/products' }))
  })

  it('genera un slug único si el nombre ya existe', async () => {
    prisma.category.findUnique.mockResolvedValue({ id: 'cat1' })
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'otro' })   // "camiseta" ocupado
      .mockResolvedValueOnce(null)             // "camiseta-2" libre
      .mockResolvedValue({ id: 'p-new', images: [], variants: [], availableSizes: [], discounts: [] })
    prisma.product.create.mockResolvedValueOnce({ id: 'p-new' })
    prisma.$transaction.mockImplementation(async (cb) => cb(prisma))

    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Camiseta', basePrice: '59900', categorySlug: 'camisetas' })
    expect(res.status).toBe(201)
    expect(prisma.product.create.mock.calls[0][0].data.slug).toBe('camiseta-2')
  })
})

describe('POST /api/v1/admin/colors', () => {
  it('crea un color nuevo con hex válido', async () => {
    prisma.color.findFirst.mockResolvedValueOnce(null)
    prisma.color.aggregate.mockResolvedValueOnce({ _max: { order: 36 } })
    prisma.color.create.mockResolvedValueOnce({ id: 'c99', name: 'Terracota', hex: '#E2725B', order: 37 })
    const res = await request(app)
      .post('/api/v1/admin/colors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Terracota', hex: '#e2725b' })
    expect(res.status).toBe(201)
    expect(prisma.color.create).toHaveBeenCalledWith({
      data: { name: 'Terracota', slug: 'terracota', hex: '#E2725B', order: 37 },
    })
  })

  it('rechaza hex inválido', async () => {
    const res = await request(app)
      .post('/api/v1/admin/colors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Raro', hex: 'rojo' })
    expect(res.status).toBe(400)
  })
})

describe('Validation guards on product payloads', () => {
  it('POST /products rejects empty name', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ basePrice: 100, categorySlug: 'camisetas' })
    expect(res.status).toBe(400)
    expect(res.body.errors.some((e) => e.field === 'name')).toBe(true)
  })

  it('POST /products rejects missing category', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Test', basePrice: 100 })
    expect(res.status).toBe(400)
  })

  it('POST /products rejects invalid variants JSON', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Test', basePrice: 100, categorySlug: 'camisetas', variants: 'not-json' })
    expect(res.status).toBe(400)
  })

  it('POST /products rejects negative price', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Test', basePrice: -10, categorySlug: 'camisetas' })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/v1/admin/products/:id (IVA)', () => {
  const existing = { id: 'p1', name: 'X', slug: 'x', basePrice: 20000, taxRate: 19, price: 23800 }
  const full = { id: 'p1', images: [], variants: [], availableSizes: [], discounts: [] }
  const setupUpdate = () => {
    prisma.product.findUnique.mockResolvedValueOnce(existing).mockResolvedValue(full)
    prisma.$transaction.mockImplementation(async (cb) => cb(prisma))
    prisma.product.update.mockResolvedValue({})
    prisma.productVariant.findMany.mockResolvedValue([])
  }

  it('cambiar basePrice recalcula price', async () => {
    setupUpdate()
    await request(app).put('/api/v1/admin/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`).send({ basePrice: 30000 })
    const data = prisma.product.update.mock.calls[0][0].data
    expect(data.basePrice).toBe(30000)
    expect(data.price).toBe(35700)
  })

  it('pasar a exento (taxRate 0) recalcula price desde la base existente', async () => {
    setupUpdate()
    await request(app).put('/api/v1/admin/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`).send({ taxRate: 0 })
    const data = prisma.product.update.mock.calls[0][0].data
    expect(data.taxRate).toBe(0)
    expect(data.price).toBe(20000)
  })

  it('sin tocar precio ni tasa no escribe price', async () => {
    setupUpdate()
    await request(app).put('/api/v1/admin/products/p1')
      .set('Authorization', `Bearer ${adminToken()}`).send({ stock: 9 })
    const data = prisma.product.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('price')
    expect(data).not.toHaveProperty('basePrice')
  })
})
