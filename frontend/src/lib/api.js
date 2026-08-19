const BASE_URL = import.meta.env.PUBLIC_API_URL || 'https://kaes-ecomerce-production.up.railway.app/api/v1'
const FRONTEND_URL = import.meta.env.PUBLIC_FRONTEND_URL || 'https://kaes-ecomerce-production.up.railway.app'

let isRefreshing = false
let refreshSubscribers = []

const subscribeTokenRefresh = (cb) => {
  refreshSubscribers.push(cb)
}

const onTokenRefreshed = () => {
  refreshSubscribers.forEach(cb => cb())
  refreshSubscribers = []
}

const refreshAccessToken = async () => {
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!res.ok) throw new Error('Session expired')

  onTokenRefreshed()
}

const fetchWithRetry = async (url, config, maxRetries = 3, baseDelay = 1000) => {
  let lastError
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, config)
      return res
    } catch (err) {
      lastError = err
      const isNetworkError = err instanceof TypeError &&
        (err.message === 'Failed to fetch' ||
         err.message.includes('network') ||
         err.message.includes('NetworkError') ||
         err.message.includes('Connection'))
      if (!isNetworkError || attempt === maxRetries) throw err
      const delay = baseDelay * Math.pow(2, attempt - 1)
      console.log(`[API] Network error, retry ${attempt}/${maxRetries} in ${delay}ms...`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}

const request = async (endpoint, options = {}) => {
  const isFormData = options.body instanceof FormData

  const config = {
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...options,
  }

  let res = await fetchWithRetry(`${BASE_URL}${endpoint}`, config)

  if (res.status === 401 && !endpoint.includes('/auth/refresh')) {
    if (!isRefreshing) {
      isRefreshing = true
      try {
        await refreshAccessToken()
        res = await fetchWithRetry(`${BASE_URL}${endpoint}`, config)
      } finally {
        isRefreshing = false
      }
    } else {
      await new Promise((resolve) => {
        subscribeTokenRefresh(() => resolve())
      })
      res = await fetchWithRetry(`${BASE_URL}${endpoint}`, config)
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Error del servidor' }))
    throw new Error(error.error || 'Error del servidor')
  }

  return res.json()
}

const bootstrapAuth = async () => {
  const { currentUser } = await import('../stores/auth.store.js')

  if (currentUser.get()) return currentUser.get()

  try {
    const data = await request('/auth/me')
    currentUser.set(data.user)
    return data.user
  } catch {
    return null
  }
}

export const api = {
  auth: {
    login:    (data) => request('/auth/login',    { method: 'POST', body: JSON.stringify(data) }),
    register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    me:       ()     => request('/auth/me'),
    logout:   ()     => request('/auth/logout',   { method: 'POST' }),
  },
  products: {
    list:   (params = {}) => request(`/products?${new URLSearchParams(params)}`),
    detail: (slug)        => request(`/products/${slug}`),
    create: (formData)    => request('/products', { method: 'POST', body: formData, headers: {} }),
    update: (id, formData)=> request(`/products/${id}`, { method: 'PUT', body: formData, headers: {} }),
    delete: (id)          => request(`/products/${id}`, { method: 'DELETE' }),
  },
  categories: {
    list:   ()     => request('/products/categories'),
    create: (data) => request('/products/categories', { method: 'POST', body: JSON.stringify(data) }),
  },
  cart: {
    get:    ()            => request('/cart'),
    add:    (data)        => request('/cart',           { method: 'POST',   body: JSON.stringify(data) }),
    update: (itemId, qty) => request(`/cart/${itemId}`, { method: 'PUT',    body: JSON.stringify({ quantity: qty }) }),
    remove: (itemId)      => request(`/cart/${itemId}`, { method: 'DELETE' }),
    clear:  ()            => request('/cart',           { method: 'DELETE' }),
  },
  orders: {
    create: (data) => request('/orders',      { method: 'POST', body: JSON.stringify(data) }),
    list:   ()     => request('/orders'),
    detail: (id)   => request(`/orders/${id}`),
  },
  admin: {
    stats:          ()            => request('/admin/stats'),
    products:      (params = {}) => request(`/admin/products?${new URLSearchParams(params)}`),
    orders:         (params = {}) => request(`/admin/orders?${new URLSearchParams(params)}`),
    updateOrder:    (id, status)  => request(`/admin/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    discounts:      ()            => request('/admin/discounts'),
    createDiscount: (data)        => request('/admin/discounts', { method: 'POST', body: JSON.stringify(data) }),
    coupons:        ()            => request('/admin/coupons'),
    createCoupon:   (data)      => request('/admin/coupons',   { method: 'POST', body: JSON.stringify(data) }),
  },
  payments: {
    createPreference: (data) => request('/payments/create-preference', { method: 'POST', body: JSON.stringify(data) }),
    getStatus: (orderId) => request(`/payments/status/${orderId}`),
    wompi: {
      createCheckout: (orderId) => request('/payments/wompi/create-checkout', { method: 'POST', body: JSON.stringify({ orderId }) }),
      getAcceptanceToken: () => request('/payments/wompi/acceptance-token'),
    },
  },
  coupons: {
    validate: (code, subtotal = 0) => request(`/coupons/${code}?subtotal=${subtotal}`),
  },
}

export { bootstrapAuth }
