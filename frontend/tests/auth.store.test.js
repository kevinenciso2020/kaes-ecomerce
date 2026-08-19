import { describe, it, expect, vi, beforeEach } from 'vitest'

let authStoreModule

const loadFresh = async () => {
  vi.resetModules()
  vi.doMock('../src/stores/cart.store.js', () => ({
    initCart: vi.fn(),
    logoutCart: vi.fn(),
    cartItems: { get: () => [], set: vi.fn(), subscribe: vi.fn() },
    cartOpen: { get: () => false, set: vi.fn(), subscribe: vi.fn() },
    cartLoading: { get: () => false, set: vi.fn(), subscribe: vi.fn() },
    cartCount: { get: () => 0, set: vi.fn(), subscribe: vi.fn() },
    cartTotal: { get: () => 0, set: vi.fn(), subscribe: vi.fn() },
    addToCart: vi.fn(),
    removeFromCart: vi.fn(),
    updateQuantity: vi.fn(),
    clearCart: vi.fn(),
  }))
  authStoreModule = await import('../src/stores/auth.store.js')
}

beforeEach(async () => {
  window.localStorage.clear()
  vi.restoreAllMocks()
  await loadFresh()
})

describe('auth.store — initial state', () => {
  it('currentUser defaults to null', () => {
    expect(authStoreModule.currentUser.get()).toBe(null)
  })

  it('restores user from localStorage on load', async () => {
    window.localStorage.setItem('user', JSON.stringify({ id: 'u1', email: 'a@b.com' }))
    await loadFresh()
    expect(authStoreModule.currentUser.get()).toEqual({ id: 'u1', email: 'a@b.com' })
  })

  it('ignores malformed JSON in localStorage', async () => {
    window.localStorage.setItem('user', '{not json')
    await loadFresh()
    expect(authStoreModule.currentUser.get()).toBe(null)
  })

  it('does NOT touch accessToken or refreshToken in localStorage', async () => {
    window.localStorage.setItem('accessToken', 'fake-access')
    window.localStorage.setItem('refreshToken', 'fake-refresh')
    await loadFresh()
    expect(authStoreModule.currentUser.get()).toBe(null)
  })
})

describe('setAuth', () => {
  it('sets currentUser and writes user to localStorage', async () => {
    const user = { id: 'u1', email: 'a@b.com', role: 'CUSTOMER' }
    await authStoreModule.setAuth(user)
    expect(authStoreModule.currentUser.get()).toEqual(user)
    expect(JSON.parse(window.localStorage.getItem('user'))).toEqual(user)
  })

  it('does NOT write accessToken or refreshToken to localStorage', async () => {
    await authStoreModule.setAuth({ id: 'u1', email: 'a@b.com' })
    expect(window.localStorage.getItem('accessToken')).toBe(null)
    expect(window.localStorage.getItem('refreshToken')).toBe(null)
  })

  it('calls initCart after setting', async () => {
    const { initCart } = await import('../src/stores/cart.store.js')
    await authStoreModule.setAuth({ id: 'u1', email: 'a@b.com' })
    expect(initCart).toHaveBeenCalledOnce()
  })
})

describe('clearAuth', () => {
  it('clears currentUser and removes user from localStorage', async () => {
    authStoreModule.currentUser.set({ id: 'u1', email: 'a@b.com' })
    window.localStorage.setItem('user', JSON.stringify({ id: 'u1' }))
    await authStoreModule.clearAuth()
    expect(authStoreModule.currentUser.get()).toBe(null)
    expect(window.localStorage.getItem('user')).toBe(null)
  })

  it('calls logoutCart', async () => {
    const { logoutCart } = await import('../src/stores/cart.store.js')
    await authStoreModule.clearAuth()
    expect(logoutCart).toHaveBeenCalledOnce()
  })
})