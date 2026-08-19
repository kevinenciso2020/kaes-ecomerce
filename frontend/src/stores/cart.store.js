import { atom, computed } from 'nanostores'
import { currentUser } from './auth.store.js'
import { api } from '../lib/api.js'

export const cartItems = atom([])
export const cartOpen  = atom(false)
export const cartLoading = atom(false)

const isLoggedIn = () => !!currentUser.get()

const saveToLocalStorage = (items) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('cart', JSON.stringify(items))
  }
}

const loadCartFromAPI = async () => {
  try {
    cartLoading.set(true)
    const { items } = await api.cart.get()
    return items.map(item => ({
      id: item.productId,
      name: item.product?.name || '',
      price: parseFloat(item.product?.price || 0),
      image: item.product?.images?.[0]?.url || '',
      slug: item.product?.slug || '',
      size: item.size,
      color: item.color,
      quantity: item.quantity,
      cartItemId: item.id,
    }))
  } catch (err) {
    console.error('Error loading cart from API:', err)
    return []
  } finally {
    cartLoading.set(false)
  }
}

const syncCartToAPI = async (items, action = 'get') => {
  const localItems = items.filter(item => !item.cartItemId)
  for (const item of localItems) {
    await api.cart.add({
      productId: item.id,
      quantity: item.quantity,
      size: item.size,
      color: item.color,
    })
  }
}

if (typeof window !== 'undefined') {
  const saved = localStorage.getItem('cart')
  if (saved) {
    try { cartItems.set(JSON.parse(saved)) } catch {}
  }
  cartItems.subscribe(items => {
    if (!isLoggedIn()) {
      saveToLocalStorage(items)
    }
  })
}

export const initCart = async () => {
  if (isLoggedIn()) {
    const localCart = cartItems.get()
    const apiCart = await loadCartFromAPI()
    const merged = [...apiCart]
    for (const localItem of localCart) {
      const existing = merged.find(item =>
        item.id === localItem.id &&
        item.size === localItem.size &&
        item.color === localItem.color
      )
      if (existing) {
        existing.quantity += localItem.quantity
      } else {
        merged.push(localItem)
      }
    }
    saveToLocalStorage([])
    cartItems.set(merged)
    await syncCartToAPI(merged)
  }
}

export const logoutCart = () => {
  saveToLocalStorage(cartItems.get())
}

export const cartCount = computed(cartItems, items =>
  items.reduce((sum, item) => sum + item.quantity, 0)
)

export const cartTotal = computed(cartItems, items =>
  items.reduce((sum, item) => sum + (item.price * item.quantity), 0)
)

export const addToCart = async (product, quantity = 1, size = null, color = null) => {
  if (isLoggedIn()) {
    try {
      await api.cart.add({
        productId: product.id,
        quantity,
        size,
        color,
      })
      const apiCart = await loadCartFromAPI()
      cartItems.set(apiCart)
    } catch (err) {
      console.error('Error adding to cart:', err)
    }
  } else {
    const current = cartItems.get()
    const existingIndex = current.findIndex(item =>
      item.id === product.id && item.size === size && item.color === color
    )
    if (existingIndex >= 0) {
      const updated = [...current]
      updated[existingIndex] = {
        ...updated[existingIndex],
        quantity: updated[existingIndex].quantity + quantity
      }
      cartItems.set(updated)
    } else {
      cartItems.set([...current, {
        id:       product.id,
        name:     product.name,
        price:    parseFloat(product.price),
        image:    product.images?.[0]?.url || '',
        slug:     product.slug,
        size,
        color,
        quantity,
      }])
    }
  }
}

export const removeFromCart = async (id, size, color) => {
  if (isLoggedIn()) {
    const item = cartItems.get().find(i =>
      i.id === id && i.size === size && i.color === color
    )
    if (item?.cartItemId) {
      await api.cart.remove(item.cartItemId)
    }
    const apiCart = await loadCartFromAPI()
    cartItems.set(apiCart)
  } else {
    cartItems.set(
      cartItems.get().filter(item =>
        !(item.id === id && item.size === size && item.color === color)
      )
    )
  }
}

export const updateQuantity = async (id, size, color, quantity) => {
  if (isLoggedIn()) {
    const item = cartItems.get().find(i =>
      i.id === id && i.size === size && i.color === color
    )
    if (item?.cartItemId) {
      if (quantity <= 0) {
        await api.cart.remove(item.cartItemId)
      } else {
        await api.cart.update(item.cartItemId, quantity)
      }
      const apiCart = await loadCartFromAPI()
      cartItems.set(apiCart)
    }
  } else {
    if (quantity <= 0) {
      cartItems.set(
        cartItems.get().filter(item =>
          !(item.id === id && item.size === size && item.color === color)
        )
      )
    } else {
      cartItems.set(
        cartItems.get().map(item =>
          item.id === id && item.size === size && item.color === color
            ? { ...item, quantity }
            : item
        )
      )
    }
  }
}

export const clearCart = async () => {
  if (isLoggedIn()) {
    try {
      await api.cart.clear()
    } catch (err) {
      console.error('Error clearing cart:', err)
    }
  }
  cartItems.set([])
}

if (typeof window !== 'undefined' && isLoggedIn()) {
  initCart()
}