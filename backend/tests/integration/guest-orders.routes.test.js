import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    order: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { create: vi.fn(), findUnique: vi.fn() },
    address: { create: vi.fn() },
  },
  buildQuote: vi.fn(),
}))

vi.mock('../../src/config/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../../src/services/pricing.service.js', () => ({ buildQuote: mocks.buildQuote }))
vi.mock('../../src/middleware/upload.middleware.js', async () => {
  const { makeUploadMock } = await import('../mocks/upload.mock.js')
  return makeUploadMock()
})

import request from 'supertest'
import app from '../../src/app.js'
import { signGuestToken } from '../../src/services/guest.service.js'

const quote = {
  subtotal: 59900, discount: 0, shipping: 5000, total: 64900, coupon: null,
  items: [{ productId: 'p1', variantId: null, quantity: 1, unitPrice: 59900, size: 'M', color: 'Negro', taxRate: 0.19 }],
}
const validBody = (over = {}) => ({
  items: [{ productId: 'p1', quantity: 1, size: 'M', color: 'Negro' }],
  acceptTerms: true,
  contact: { email: 'Ana@Correo.com', name: 'Ana Pérez', phone: '3001234567' },
  address: { fullName: 'Ana Pérez', phone: '3001234567', street: 'Calle 1 # 2-3', departamento: 'Antioquia', municipio: 'Medellín' },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.buildQuote.mockResolvedValue(quote)
  mocks.prisma.order.create.mockImplementation(async ({ data }) => ({ id: 'ord-g1', ...data, items: [] }))
})

describe('POST /api/v1/orders/quote (pública)', () => {
  it('responde sin sesión', async () => {
    const res = await request(app).post('/api/v1/orders/quote').send({ items: [{ productId: 'p1', quantity: 1 }] })
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(64900)
  })
})

describe('POST /api/v1/orders/guest', () => {
  it('crea la orden SIN usuario ni dirección (una sola escritura) y devuelve el token', async () => {
    const res = await request(app).post('/api/v1/orders/guest').send(validBody())
    expect(res.status).toBe(201)
    expect(res.body.guestToken).toEqual(expect.any(String))
    expect(mocks.prisma.user.create).not.toHaveBeenCalled()
    expect(mocks.prisma.address.create).not.toHaveBeenCalled()
    const { data } = mocks.prisma.order.create.mock.calls[0][0]
    expect(data).toMatchObject({
      userId: null, guestEmail: 'ana@correo.com', guestName: 'Ana Pérez', total: 64900,
      guestShipping: expect.objectContaining({ street: 'Calle 1 # 2-3', municipio: 'Medellín' }),
    })
  })

  it('usa el total calculado por el servidor, no el del cliente', async () => {
    await request(app).post('/api/v1/orders/guest').send(validBody({ total: 1 }))
    expect(mocks.prisma.order.create.mock.calls[0][0].data.total).toBe(64900)
  })

  it('400 sin correo válido, sin dirección o sin aceptar términos', async () => {
    expect((await request(app).post('/api/v1/orders/guest').send(validBody({ contact: { email: 'no-es-correo' } }))).status).toBe(400)
    expect((await request(app).post('/api/v1/orders/guest').send(validBody({ address: undefined }))).status).toBe(400)
    expect((await request(app).post('/api/v1/orders/guest').send(validBody({ acceptTerms: false }))).status).toBe(400)
    expect(mocks.prisma.order.create).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/orders/guest/:id', () => {
  it('401 sin token', async () => {
    expect((await request(app).get('/api/v1/orders/guest/ord-g1')).status).toBe(401)
  })

  it('404 si el token es de otra orden', async () => {
    const res = await request(app).get('/api/v1/orders/guest/ord-g1').set('x-guest-token', signGuestToken('ord-otra'))
    expect(res.status).toBe(404)
    expect(mocks.prisma.order.findFirst).not.toHaveBeenCalled()
  })

  it('devuelve el pedido con el token correcto', async () => {
    mocks.prisma.order.findFirst.mockResolvedValueOnce({
      id: 'ord-g1', userId: null, guestEmail: 'a@b.co', guestName: 'Ana', guestShipping: {}, items: [], payment: null,
    })
    const res = await request(app).get('/api/v1/orders/guest/ord-g1').set('x-guest-token', signGuestToken('ord-g1'))
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('ord-g1')
    expect(mocks.prisma.order.findFirst.mock.calls[0][0].where).toEqual({ id: 'ord-g1', userId: null })
  })
})

describe('las rutas de cuenta siguen exigiendo sesión', () => {
  it('GET /orders y POST /orders → 401', async () => {
    expect((await request(app).get('/api/v1/orders/')).status).toBe(401)
    expect((await request(app).post('/api/v1/orders/').send({})).status).toBe(401)
  })
})
