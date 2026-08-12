import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  sanitizeProduct,
  sanitizeCartItem,
  sanitizeOrder,
  sanitizeUser,
  sanitizeDiscount,
} from '../src/lib/sanitize.js'

describe('escapeHtml', () => {
  it('escapes the 5 dangerous characters', () => {
    expect(escapeHtml('<script>alert("xss&")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&amp;&quot;)&lt;/script&gt;',
    )
  })

  it('escapes apostrophes', () => {
    expect(escapeHtml("don't")).toBe('don&#039;t')
  })

  it('returns empty string for null and undefined', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })

  it('coerces non-string values to string', () => {
    expect(escapeHtml(42)).toBe('42')
    expect(escapeHtml(true)).toBe('true')
  })

  it('returns empty string when value is empty string', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('does not double-escape & (runs once)', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
    expect(escapeHtml('a &amp; b')).toBe('a &amp;amp; b')
  })
})

describe('sanitizeProduct', () => {
  it('returns null for falsy input', () => {
    expect(sanitizeProduct(null)).toBe(null)
    expect(sanitizeProduct(undefined)).toBe(null)
  })

  it('escapes name, slug, description', () => {
    const p = { name: '<b>X</b>', slug: 'a&b', description: 'hi' }
    const out = sanitizeProduct(p)
    expect(out.name).toBe('&lt;b&gt;X&lt;/b&gt;')
    expect(out.slug).toBe('a&amp;b')
    expect(out.description).toBe('hi')
    expect(out.id).toBe(p.id)
  })
})

describe('sanitizeCartItem', () => {
  it('returns {} for null', () => {
    expect(sanitizeCartItem(null)).toEqual({})
  })

  it('escapes name, size, color', () => {
    const item = { id: 1, name: '<a', size: 'M&L', color: 'red' }
    const out = sanitizeCartItem(item)
    expect(out.name).toBe('&lt;a')
    expect(out.size).toBe('M&amp;L')
    expect(out.color).toBe('red')
  })
})

describe('sanitizeOrder', () => {
  it('returns null for null', () => {
    expect(sanitizeOrder(null)).toBe(null)
  })

  it('escapes shipping address nested fields', () => {
    const order = {
      id: 'o1',
      status: 'PENDING',
      notes: '<note>',
      shippingAddress: {
        street: '<st>',
        city: 'BOG',
        department: 'D1',
        departamento: 'D2',
        municipio: 'M1',
        zipCode: '1111',
        fullName: 'A & B',
        phone: '123',
        label: 'home',
      },
    }
    const out = sanitizeOrder(order)
    expect(out.id).toBe('o1')
    expect(out.status).toBe('PENDING')
    expect(out.notes).toBe('&lt;note&gt;')
    expect(out.shippingAddress.street).toBe('&lt;st&gt;')
    expect(out.shippingAddress.fullName).toBe('A &amp; B')
  })

  it('keeps shippingAddress untouched when not an object', () => {
    const order = { id: 'o1', status: 'PENDING', shippingAddress: 'string-addr' }
    const out = sanitizeOrder(order)
    expect(out.shippingAddress).toBe('string-addr')
  })
})

describe('sanitizeUser', () => {
  it('returns null for null', () => {
    expect(sanitizeUser(null)).toBe(null)
  })

  it('escapes name and email', () => {
    const u = { id: 'u1', name: '<a>', email: 'a@b.com' }
    expect(sanitizeUser(u).name).toBe('&lt;a&gt;')
    expect(sanitizeUser(u).email).toBe('a@b.com')
  })
})

describe('sanitizeDiscount', () => {
  it('returns null for null', () => {
    expect(sanitizeDiscount(null)).toBe(null)
  })

  it('escapes code and description', () => {
    const d = { code: '<x>', description: 'a & b' }
    expect(sanitizeDiscount(d).code).toBe('&lt;x&gt;')
    expect(sanitizeDiscount(d).description).toBe('a &amp; b')
  })
})