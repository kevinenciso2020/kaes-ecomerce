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

// Sube al servidor los ítems que sólo existían en el carrito local (invitado).
// El backend suma la cantidad si el mismo producto/talla/color ya existe.
const syncLocalItemsToAPI = async (localItems) => {
  for (const item of localItems) {
    try {
      await api.cart.add({
        productId: item.id,
        quantity: item.quantity,
        size: item.size,
        color: item.color,
      })
    } catch (err) {
      console.error('Error sincronizando ítem del carrito:', err)
    }
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
    const localOnly = cartItems.get().filter(item => !item.cartItemId)
    if (localOnly.length > 0) await syncLocalItemsToAPI(localOnly)
    saveToLocalStorage([])
    // El servidor es la fuente de verdad una vez hay sesión.
    cartItems.set(await loadCartFromAPI())
  }
}

/** Vacía sólo el estado local (el servidor ya vació el carrito al aprobar el pago). */
export const resetLocalCart = () => {
  cartItems.set([])
  saveToLocalStorage([])
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

// Promesa compartida de la carga inicial del carrito desde el servidor. Las
// páginas que leen el carrito una sola vez (checkout) deben esperarla; si no,
// ven el carrito vacío mientras la petición está en curso.
let loadPromise = null
export const ensureCartLoaded = () => {
  if (!isLoggedIn()) return Promise.resolve()
  if (!loadPromise) loadPromise = initCart().catch(() => {})
  return loadPromise
}

if (typeof window !== 'undefined' && isLoggedIn()) {
  ensureCartLoaded()
}