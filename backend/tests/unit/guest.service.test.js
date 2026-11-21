import { describe, it, expect, vi, afterEach } from 'vitest'
import { signGuestToken, verifyGuestToken, canAccessOrder, withGuestCustomer } from '../../src/services/guest.service.js'

afterEach(() => vi.useRealTimers())

describe('token de invitado', () => {
  it('firma y verifica devolviendo el orderId', () => {
    expect(verifyGuestToken(signGuestToken('ord-1'))).toBe('ord-1')
  })

  it('rechaza un token manipulado o de otra orden', () => {
    const [payload, sig] = signGuestToken('ord-1').split('.')
    const forged = Buffer.from(`ord-2.${Math.floor(Date.now() / 1000) + 1000}`).toString('base64url')
    expect(verifyGuestToken(`${forged}.${sig}`)).toBeNull()
    expect(verifyGuestToken(`${payload}.${sig.slice(0, -2)}xx`)).toBeNull()
    expect(verifyGuestToken('basura')).toBeNull()
    expect(verifyGuestToken(undefined)).toBeNull()
  })

  it('expira a los 60 días', () => {
    vi.useFakeTimers()
    const token = signGuestToken('ord-1')
    vi.setSystemTime(Date.now() + 61 * 24 * 60 * 60 * 1000)
    expect(verifyGuestToken(token)).toBeNull()
  })
})

describe('canAccessOrder', () => {
  const guestOrder = { id: 'o1', userId: null }
  const userOrder = { id: 'o2', userId: 'u1' }

  it('invitado solo accede a su propia orden sin dueño', () => {
    expect(canAccessOrder(guestOrder, { guest: { orderId: 'o1' } })).toBe(true)
    expect(canAccessOrder(guestOrder, { guest: { orderId: 'otra' } })).toBe(false)
    // un token de invitado nunca abre una orden de una cuenta
    expect(canAccessOrder(userOrder, { guest: { orderId: 'o2' } })).toBe(false)
  })

  it('dueño y admin acceden; otro usuario no', () => {
    expect(canAccessOrder(userOrder, { user: { id: 'u1', role: 'CUSTOMER' } })).toBe(true)
    expect(canAccessOrder(userOrder, { user: { id: 'u9', role: 'ADMIN' } })).toBe(true)
    expect(canAccessOrder(userOrder, { user: { id: 'u9', role: 'CUSTOMER' } })).toBe(false)
    expect(canAccessOrder(null, { user: { id: 'u1' } })).toBe(false)
  })
})

describe('withGuestCustomer', () => {
  it('expone user y shippingAddress con la forma de una orden normal', () => {
    const o = withGuestCustomer({
      id: 'o1', userId: null, guestEmail: 'a@b.co', guestName: 'Ana', guestPhone: '3001112233',
      guestShipping: { fullName: 'Ana P', phone: '3001112233', street: 'Calle 1', departamento: 'Antioquia', municipio: 'Medellín' },
    })
    expect(o.user).toEqual({ name: 'Ana', email: 'a@b.co', phone: '3001112233' })
    expect(o.shippingAddress).toMatchObject({ fullName: 'Ana P', street: 'Calle 1', municipio: 'Medellín', city: 'Medellín' })
  })

  it('no toca órdenes de cuentas ni null', () => {
    const o = { id: 'o2', userId: 'u1', user: { name: 'X' } }
    expect(withGuestCustomer(o)).toBe(o)
    expect(withGuestCustomer(null)).toBeNull()
  })
})
