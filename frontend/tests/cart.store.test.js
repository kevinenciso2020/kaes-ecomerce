import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let authStoreModule
let cartStoreModule

const loadFresh = async () => {
  vi.resetModules()
  vi.doMock('../src/lib/api.js', () => ({
    api: {
      cart: {
        get:    vi.fn(),
        add:    vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        clear:  vi.fn(),
      },
    },
  }))
  authStoreModule = await import('../src/stores/auth.store.js')
  cartStoreModule = await import('../src/stores/cart.store.js')
}

beforeEach(async () => {
  window.localStorage.clear()
  await loadFresh()
})

afterEach(() => {
  vi.unmock('../src/lib/api.js')
})

describe('cart.store — logged-out branch', () => {
  it('adds a new item with parsed price and image', async () => {
    const product = {
      id: 'p1',
      name: 'Camisa',
      price: '100.50',
      images: [{ url: 'http://img/1.jpg' }],
      slug: 'camisa',
    }
    await cartStoreModule.addToCart(product, 2, 'M', 'red')

    const items = cartStoreModule.cartItems.get()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'p1',
      name: 'Camisa',
      price: 100.5,
      image: 'http://img/1.jpg',
      slug: 'camisa',
      size: 'M',
      color: 'red',
      quantity: 2,
    })
  })

  it('increments quantity when same id+size+color already in cart', async () => {
    const product = { id: 'p1', name: 'X', price: '50', images: [], slug: 'x' }
    await cartStoreModule.addToCart(product, 1, 'M', 'red')
    await cartStoreModule.addToCart(product, 3, 'M', 'red')
    const items = cartStoreModule.cartItems.get()
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(4)
  })

  it('treats different sizes as separate cart entries', async () => {
    const product = { id: 'p1', name: 'X', price: '50', images: [], slug: 'x' }
    await cartStoreModule.addToCart(product, 1, 'M', 'red')
    await cartStoreModule.addToCart(product, 1, 'L', 'red')
    expect(cartStoreModule.cartItems.get()).toHaveLength(2)
  })

  it('removes an item by id+size+color', async () => {
    const product = { id: 'p1', name: 'X', price: '50', images: [], slug: 'x' }
    await cartStoreModule.addToCart(product, 1, 'M', 'red')
    await cartStoreModule.removeFromCart('p1', 'M', 'red')
    expect(cartStoreModule.cartItems.get()).toHaveLength(0)
  })

  it('updateQuantity > 0 changes the qty', async () => {
    const product = { id: 'p1', name: 'X', price: '50', images: [], slug: 'x' }
    await cartStoreModule.addToCart(product, 1, 'M', 'red')
    await cartStoreModule.updateQuantity('p1', 'M', 'red', 5)
    expect(cartStoreModule.cartItems.get()[0].quantity).toBe(5)
  })

  it('updateQuantity <= 0 removes the item', async () => {
    const product = { id: 'p1', name: 'X', price: '50', images: [], slug: 'x' }
    await cartStoreModule.addToCart(product, 1, 'M', 'red')
    await cartStoreModule.updateQuantity('p1', 'M', 'red', 0)
    expect(cartStoreModule.cartItems.get()).toHaveLength(0)
  })

  it('clearCart empties the array', async () => {
    const product = { id: 'p1', name: 'X', price: '50', images: [], slug: 'x' }
    await cartStoreModule.addToCart(product, 1, 'M', 'red')
    await cartStoreModule.clearCart()
    expect(cartStoreModule.cartItems.get()).toEqual([])
  })

  it('cartCount sums quantities', async () => {
    const product = { id: 'p1', name: 'X', price: '50', images: [], slug: 'x' }
    await cartStoreModule.addToCart(product, 2, 'M', 'red')
    await cartStoreModule.addToCart(product, 3, 'L', 'red')
    expect(cartStoreModule.cartCount.get()).toBe(5)
  })

  it('cartTotal sums price * quantity', async () => {
    const product = { id: 'p1', name: 'X', price: '50', images: [], slug: 'x' }
    const product2 = { id: 'p2', name: 'Y', price: '20', images: [], slug: 'y' }
    await cartStoreModule.addToCart(product, 2, 'M', 'red')
    await cartStoreModule.addToCart(product2, 3, 'L', 'blue')
    expect(cartStoreModule.cartTotal.get()).toBe(160)
  })

  it('persists items in localStorage while logged out', async () => {
    const product = { id: 'p1', name: 'X', price: '50', images: [], slug: 'x' }
    await cartStoreModule.addToCart(product, 1, 'M', 'red')
    const raw = window.localStorage.getItem('cart')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw)
    expect(parsed).toHaveLength(1)
  })
})

describe('cart.store — logged-in branch', () => {
  beforeEach(async () => {
    authStoreModule.currentUser.set({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' })
  })

  it('addToCart calls api.cart.add and reloads from API', async () => {
    const product = { id: 'p1', name: 'X', price: 50, images: [], slug: 'x' }
    cartStoreModule.cartItems.set([])
    const { api } = await import('../src/lib/api.js')
    api.cart.add.mockResolvedValueOnce({})
    api.cart.get.mockResolvedValueOnce({
      items: [{
        id: 'ci-1', productId: 'p1', size: 'M', color: 'red', quantity: 2,
        product: { name: 'X', price: '50', slug: 'x', images: [{ url: '' }] },
      }],
    })
    await cartStoreModule.addToCart(product, 2, 'M', 'red')
    expect(api.cart.add).toHaveBeenCalledWith({
      productId: 'p1', quantity: 2, size: 'M', color: 'red',
    })
    expect(cartStoreModule.cartItems.get()).toHaveLength(1)
    expect(cartStoreModule.cartItems.get()[0].quantity).toBe(2)
  })

  it('clearCart calls api.cart.clear', async () => {
    cartStoreModule.cartItems.set([])
    const { api } = await import('../src/lib/api.js')
    api.cart.clear.mockResolvedValueOnce({})
    await cartStoreModule.clearCart()
    expect(api.cart.clear).toHaveBeenCalled()
    expect(cartStoreModule.cartItems.get()).toEqual([])
  })
})