import { describe, it, expect, beforeEach } from 'vitest'
import { saveGuestToken, getGuestToken, guestHeaders } from '../src/lib/guest.js'

beforeEach(() => localStorage.clear())

describe('token de invitado', () => {
  it('guarda y recupera el token por orden', () => {
    saveGuestToken('o1', 'tok1')
    saveGuestToken('o2', 'tok2')
    expect(getGuestToken('o1')).toBe('tok1')
    expect(getGuestToken('o2')).toBe('tok2')
    expect(getGuestToken('otra')).toBeNull()
  })

  it('guestHeaders solo devuelve la cabecera si hay token', () => {
    expect(guestHeaders('o1')).toEqual({})
    saveGuestToken('o1', 'tok1')
    expect(guestHeaders('o1')).toEqual({ 'x-guest-token': 'tok1' })
  })

  it('ignora valores vacíos y no explota con almacenamiento corrupto', () => {
    saveGuestToken('', 'x')
    saveGuestToken('o1', '')
    expect(getGuestToken('o1')).toBeNull()
    localStorage.setItem('kaes_guest_orders', '{no es json')
    expect(getGuestToken('o1')).toBeNull()
    saveGuestToken('o1', 'ok')
    expect(getGuestToken('o1')).toBe('ok')
  })

  it('conserva solo las 20 órdenes más recientes', () => {
    for (let i = 0; i < 25; i++) saveGuestToken(`o${i}`, `t${i}`)
    expect(getGuestToken('o0')).toBeNull()
    expect(getGuestToken('o24')).toBe('t24')
    expect(Object.keys(JSON.parse(localStorage.getItem('kaes_guest_orders')))).toHaveLength(20)
  })
})
