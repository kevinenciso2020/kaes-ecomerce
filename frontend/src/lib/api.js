// PUBLIC_API_URL es obligatoria (p. ej. https://api.kaes.co/api/v1). Sin
// fallback a una URL hardcodeada: si falta, se nota en el primer request.
const BASE_URL = (import.meta.env.PUBLIC_API_URL || '').replace(/\/$/, '')
if (!BASE_URL && typeof window !== 'undefined') {
  console.error('[API] PUBLIC_API_URL no está configurada')
}

// En el servidor (SSR en Vercel) todas las peticiones salen de pocas IPs:
// el header x-ssr-key permite que el backend no las cuente en el rate limit
// por IP. SSR_API_KEY es un secreto de servidor (NO lleva prefijo PUBLIC_).
const ssrHeaders = () => {
  if (!import.meta.env.SSR) return {}
  const key = (typeof process !== 'undefined' && process.env?.SSR_API_KEY) || import.meta.env.SSR_API_KEY
  return key ? { 'x-ssr-key': key } : {}
}

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

export class ApiError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

const request = async (endpoint, options = {}) => {
  const isFormData = options.body instanceof FormData

  const config = {
    credentials: 'include',
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...ssrHeaders(),
      ...options.headers,
    },
  }

  let res = await fetchWithRetry(`${BASE_URL}${endpoint}`, config)

  const canRefresh = typeof window !== 'undefined' &&
    !endpoint.includes('/auth/refresh') && !endpoint.includes('/auth/login')
  if (res.status === 401 && canRefresh) {
    if (!isRefreshing) {
      isRefreshing = true
      try {
        await refreshAccessToken()
        res = await fetchWithRetry(`${BASE_URL}${endpoint}`, config)
      } catch {
        // Sesión vencida: limpiar el usuario guardado para que la UI no
        // muestre una sesión que ya no existe.
        const { clearAuth } = await import('../stores/auth.store.js')
        await clearAuth().catch(() => {})
      } finally {
        isRefreshing = false
        onTokenRefreshed()
      }
    } else {
      await new Promise((resolve) => {
        subscribeTokenRefresh(() => resolve())
      })
      res = await fetchWithRetry(`${BASE_URL}${endpoint}`, config)
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Error del servidor' }))
    // Errores de validación llegan como { errors: [{ field, message }] }
    const message = body.error || body.errors?.[0]?.message || body.message || 'Error del servidor'
    throw new ApiError(message, { status: res.status, code: body.code, body })
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
    login:           (data) => request('/auth/login',    { method: 'POST', body: JSON.stringify(data) }),
    register:        (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    me:              ()     => request('/auth/me'),
    logout:          ()     => request('/auth/logout',   { method: 'POST' }),
    verifyEmail:     (token) => request(`/auth/verify-email?token=${encodeURIComponent(token)}`),
    resendVerify:    (email) => request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),
    verifyStatus:    ()     => request('/auth/verification-status'),
    forgotPassword:  (email) => request('/auth/forgot-password',  { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword:   (data)  => request('/auth/reset-password',   { method: 'POST', body: JSON.stringify(data) }),
  },
  products: {
    list:   (params = {}) => request(`/products?${new URLSearchParams(params)}`),
    detail: (slug)        => request(`/products/${encodeURIComponent(slug)}`),
  },
  categories: {
    list:   ()     => request('/products/categories'),
  },
  cart: {
    get:    ()            => request('/cart'),
    add:    (data)        => request('/cart',           { method: 'POST',   body: JSON.stringify(data) }),
    update: (itemId, qty) => request(`/cart/${itemId}`, { method: 'PUT',    body: JSON.stringify({ quantity: qty }) }),
    remove: (itemId)      => request(`/cart/${itemId}`, { method: 'DELETE' }),
    clear:  ()            => request('/cart',           { method: 'DELETE' }),
  },
  orders: {
    quote:  (data) => request('/orders/quote', { method: 'POST', body: JSON.stringify(data) }),
    create: (data) => request('/orders',      { method: 'POST', body: JSON.stringify(data) }),
    list:   ()     => request('/orders'),
    detail: (id)   => request(`/orders/${id}`),
  },
  admin: {
    stats:          ()            => request('/admin/stats'),
    products:      (params = {}) => request(`/admin/products?${new URLSearchParams(params)}`),
    productDetail:  (id)          => request(`/admin/products/${id}`),
    createProduct:  (formData)    => request('/admin/products', { method: 'POST',  body: formData, headers: {} }),
    updateProduct:  (id, formData)=> request(`/admin/products/${id}`, { method: 'PUT', body: formData, headers: {} }),
    deleteProduct:  (id, { hard = false } = {}) => request(`/admin/products/${id}${hard ? '?hard=true' : ''}`, { method: 'DELETE' }),
    restoreProduct: (id)          => request(`/admin/products/${id}/restore`, { method: 'PATCH' }),
    addProductImages: (id, formData) => request(`/admin/products/${id}/images`, { method: 'POST', body: formData, headers: {} }),
    deleteProductImage: (productId, imageId) => request(`/admin/products/${productId}/images/${imageId}`, { method: 'DELETE' }),
    setMainImage:   (productId, imageId) => request(`/admin/products/${productId}/images/${imageId}/main`, { method: 'PATCH' }),
    upsertVariants: (productId, variants) => request(`/admin/products/${productId}/variants`, { method: 'PATCH', body: JSON.stringify({ variants }) }),
    lowStock:       (params = {}) => request(`/admin/products/low-stock?${new URLSearchParams(params)}`),

    orders:         (params = {}) => request(`/admin/orders?${new URLSearchParams(params)}`),
    orderDetail:    (id)          => request(`/admin/orders/${id}`),
    updateOrder:    (id, status, note) => request(`/admin/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, note }) }),
    resolveReview:  (id, note)    => request(`/admin/orders/${id}/resolve-review`, { method: 'PATCH', body: JSON.stringify({ note }) }),

    dashboard: {
      overview:     ()              => request('/admin/dashboard/overview'),
      sales:        (params = {})   => request(`/admin/dashboard/sales?${new URLSearchParams(params)}`),
      topProducts:  (params = {})   => request(`/admin/dashboard/top-products?${new URLSearchParams(params)}`),
      byCategory:   (params = {})   => request(`/admin/dashboard/by-category?${new URLSearchParams(params)}`),
      recentOrders: (params = {})   => request(`/admin/dashboard/recent-orders?${new URLSearchParams(params)}`),
      lowStock:     (params = {})   => request(`/admin/dashboard/low-stock?${new URLSearchParams(params)}`),
    },

    colors: ()         => request('/admin/colors'),
    createColor: (data)     => request('/admin/colors', { method: 'POST', body: JSON.stringify(data) }),
    updateColor: (id, data) => request(`/admin/colors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteColor: (id)       => request(`/admin/colors/${id}`, { method: 'DELETE' }),
    sizes:  (scale)    => request(`/admin/sizes${scale ? `?scale=${scale}` : ''}`),
    categories:     ()         => request('/admin/categories'),
    createCategory: (data)     => request('/admin/categories', { method: 'POST', body: JSON.stringify(data) }),
    updateCategory: (id, data) => request(`/admin/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteCategory: (id)       => request(`/admin/categories/${id}`, { method: 'DELETE' }),

    discounts:      ()            => request('/admin/discounts'),
    createDiscount: (data)        => request('/admin/discounts', { method: 'POST', body: JSON.stringify(data) }),
    updateDiscount: (id, data)    => request(`/admin/discounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteDiscount: (id)          => request(`/admin/discounts/${id}`, { method: 'DELETE' }),
    coupons:        ()            => request('/admin/coupons'),
    createCoupon:   (data)        => request('/admin/coupons', { method: 'POST', body: JSON.stringify(data) }),
    updateCoupon:   (id, data)    => request(`/admin/coupons/${id}`, { method: 'PUT',  body: JSON.stringify(data) }),
    users:          (params = {}) => request(`/admin/users?${new URLSearchParams(params)}`),
    updateUser:     (id, data)    => request(`/admin/users/${id}`,     { method: 'PUT',    body: JSON.stringify(data) }),
    updateUserRole: (id, role)    => request(`/admin/users/${id}/role`, { method: 'PUT',    body: JSON.stringify({ role }) }),
    deleteUser:     (id, params)  => request(`/admin/users/${id}${params ? `?${new URLSearchParams(params)}` : ''}`, { method: 'DELETE' }),
    messages:       (params = {}) => request(`/admin/messages?${new URLSearchParams(params)}`),
    markMessageRead:(id, isRead = true) => request(`/admin/messages/${id}/read`, { method: 'PUT', body: JSON.stringify({ isRead }) }),
    deleteMessage:  (id)          => request(`/admin/messages/${id}`, { method: 'DELETE' }),
  },
  payments: {
    methods: () => request('/payments/methods'),
    createPreference: (orderId) => request('/payments/create-preference', { method: 'POST', body: JSON.stringify({ orderId }) }),
    getStatus: (orderId) => request(`/payments/status/${orderId}`),
    verify: (orderId, data = {}) => request(`/payments/verify/${orderId}`, { method: 'POST', body: JSON.stringify(data) }),
    wompi: {
      createCheckout: (orderId) => request('/payments/wompi/checkout', { method: 'POST', body: JSON.stringify({ orderId }) }),
    },
  },
  coupons: {
    validate: (code, subtotal = 0) => request(`/coupons/${encodeURIComponent(code)}?subtotal=${subtotal}`),
  },
  contact: {
    send: (data) => request('/contact', { method: 'POST', body: JSON.stringify(data) }),
  },
  // Catálogo canónico — público (sin auth), usado por la tienda.
  // Equivale a `api.admin.colors()` / `api.admin.sizes()` pero accesible
  // desde páginas no-admin (productos/index.astro renderiza en SSR).
  catalog: {
    colors: ()         => request('/colors'),
    sizes:  (scale)    => request(`/sizes${scale ? `?scale=${scale}` : ''}`),
  },
}

export { bootstrapAuth }
