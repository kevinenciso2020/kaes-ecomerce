import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getToken, resetTokenCache, createApplication, buildApplicationBody, verifyCallbackAuth, isAddiConfigured,
} from '../../src/config/addi.js'
import { mapAddiStatus, PAY } from '../../src/services/payment.service.js'

const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`

const order = {
  id: 'ckorder12345678',
  total: '129900.00',
  shipping: '0',
  user: { email: 'ana@test.co', name: 'Ana' },
  shippingAddress: { fullName: 'Ana María Pérez Gómez', phone: '+57 300 123 4567', street: 'Calle 1 # 2-3', municipio: 'Medellín' },
}

beforeEach(() => {
  resetTokenCache()
  process.env.ADDI_CLIENT_ID = 'cid'
  process.env.ADDI_CLIENT_SECRET = 'csecret'
  process.env.ADDI_ALLY_SLUG = 'kaes-ecommerce'
  process.env.ADDI_CALLBACK_USER = 'addi'
  process.env.ADDI_CALLBACK_PASSWORD = 'clave-larga'
  delete process.env.ADDI_ENV
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isAddiConfigured', () => {
  it('requiere credenciales y usuario/clave del callback', () => {
    expect(isAddiConfigured()).toBe(true)
    delete process.env.ADDI_CALLBACK_PASSWORD
    expect(isAddiConfigured()).toBe(false)
  })
})

describe('getToken', () => {
  it('pide el token a staging por defecto y lo cachea', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) })
    vi.stubGlobal('fetch', fetchMock)

    expect(await getToken()).toBe('tok')
    expect(await getToken()).toBe('tok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://auth.addi-staging.com/oauth/token')
    expect(JSON.parse(opts.body)).toMatchObject({ grant_type: 'client_credentials', client_id: 'cid', client_secret: 'csecret' })
  })

  it('usa producción con ADDI_ENV=production', async () => {
    process.env.ADDI_ENV = 'production'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok' }) })
    vi.stubGlobal('fetch', fetchMock)
    await getToken()
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.addi.com/oauth/token')
  })

  it('lanza 502 si Addi rechaza las credenciales', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    await expect(getToken()).rejects.toMatchObject({ status: 502, code: 'ADDI_UNAVAILABLE' })
  })
})

describe('createApplication', () => {
  it('envía el TOTAL de la orden y devuelve el header Location', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: false, status: 301, headers: new Headers({ location: 'https://addi.test/flujo' }) })
    vi.stubGlobal('fetch', fetchMock)

    const url = await createApplication({ order, callbackUrl: 'https://api/cb', redirectionUrl: 'https://front/r' })
    expect(url).toBe('https://addi.test/flujo')

    const [appUrl, opts] = fetchMock.mock.calls[1]
    expect(appUrl).toBe('https://api.addi-staging.com/v1/online-applications')
    expect(opts.redirect).toBe('manual')
    expect(opts.headers.Authorization).toBe('Bearer tok')
    const body = JSON.parse(opts.body)
    expect(body.totalAmount).toBe(129900)
    expect(body.orderId).toBe(order.id)
    expect(body.allyUrlRedirection).toEqual({ callbackUrl: 'https://api/cb', redirectionUrl: 'https://front/r' })
  })

  it('lanza 502 si Addi no devuelve enlace', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: false, status: 400, headers: new Headers() }))
    await expect(createApplication({ order, callbackUrl: 'a', redirectionUrl: 'b' })).rejects.toMatchObject({ status: 502 })
  })
})

describe('buildApplicationBody', () => {
  it('normaliza celular y separa nombres', () => {
    const body = buildApplicationBody({ order, callbackUrl: 'a', redirectionUrl: 'b' })
    expect(body.client).toMatchObject({
      firstName: 'Ana María', lastName: 'Pérez Gómez', email: 'ana@test.co', cellphone: '3001234567', cellphoneCountryCode: '+57',
    })
    expect(body.items).toHaveLength(1)
    expect(body.items[0].unitPrice).toBe(129900)
    expect(body.client.idNumber).toBeUndefined()
  })
})

describe('verifyCallbackAuth', () => {
  it('acepta el usuario y la clave configurados', () => {
    expect(verifyCallbackAuth(basic('addi', 'clave-larga'))).toEqual({ valid: true })
  })

  it.each([
    [undefined, 'authorization_missing'],
    ['Bearer x', 'authorization_missing'],
    [basic('addi', 'otra'), 'authorization_invalid'],
    [basic('otro', 'clave-larga'), 'authorization_invalid'],
  ])('rechaza %s', (header, reason) => {
    expect(verifyCallbackAuth(header)).toEqual({ valid: false, reason })
  })

  it('rechaza todo si no hay credenciales configuradas', () => {
    delete process.env.ADDI_CALLBACK_USER
    expect(verifyCallbackAuth(basic('', '')).valid).toBe(false)
  })
})

describe('mapAddiStatus', () => {
  it.each([
    ['APPROVED', PAY.APPROVED],
    ['REJECTED', PAY.DECLINED],
    ['DECLINED', PAY.DECLINED],
    ['ABANDONED', PAY.DECLINED],
    ['INTERNAL_ERROR', PAY.ERROR],
    ['PENDING', PAY.PENDING],
    [undefined, PAY.PENDING],
  ])('%s → %s', (input, expected) => {
    expect(mapAddiStatus(input)).toBe(expected)
  })
})
