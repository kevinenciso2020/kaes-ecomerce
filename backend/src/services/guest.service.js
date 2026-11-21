import crypto from 'crypto'

// Compra como invitado: no se crea usuario ni dirección en la BD. El acceso del
// invitado a SU pedido se prueba con un token firmado (HMAC) que no se guarda
// en ningún lado: se valida solo con el secreto del servidor.

const GUEST_TOKEN_TTL_DAYS = 60

const secret = () => `guest-order:${process.env.JWT_SECRET}`

const sign = (payload) =>
  crypto.createHmac('sha256', secret()).update(payload).digest('base64url')

/** Token de acceso a una orden de invitado: `<base64url(orderId.exp)>.<firma>`. */
export const signGuestToken = (orderId) => {
  const exp = Math.floor(Date.now() / 1000) + GUEST_TOKEN_TTL_DAYS * 24 * 60 * 60
  const payload = Buffer.from(`${orderId}.${exp}`).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Devuelve el orderId del token o null si es inválido/expirado. */
export const verifyGuestToken = (token) => {
  if (typeof token !== 'string' || token.length > 300) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  const decoded = Buffer.from(payload, 'base64url').toString()
  const dot = decoded.lastIndexOf('.')
  if (dot < 1) return null
  const orderId = decoded.slice(0, dot)
  const exp = Number(decoded.slice(dot + 1))
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null
  return orderId
}

const isAdminRole = (role) => role === 'ADMIN' || role === 'SUPER_ADMIN'

/** ¿Quien hace la petición puede ver/operar esta orden? (dueño, admin o invitado con token) */
export const canAccessOrder = (order, { user, guest } = {}) => {
  if (!order) return false
  if (user && ((order.userId && order.userId === user.id) || isAdminRole(user.role))) return true
  return Boolean(guest && guest.orderId === order.id && !order.userId)
}

/**
 * Los consumidores (pasarelas, correos, facturación) leen `order.user` y
 * `order.shippingAddress`. En una orden de invitado esos datos viven en las
 * columnas guest*; este helper los expone con la misma forma.
 */
export const withGuestCustomer = (order) => {
  if (!order || order.userId || !order.guestEmail) return order
  const ship = order.guestShipping || {}
  return {
    ...order,
    user: { name: order.guestName, email: order.guestEmail, phone: order.guestPhone },
    shippingAddress: order.shippingAddress ?? {
      fullName: ship.fullName || order.guestName,
      phone: ship.phone || order.guestPhone,
      street: ship.street,
      departamento: ship.departamento,
      department: ship.departamento,
      municipio: ship.municipio,
      city: ship.municipio,
      zipCode: ship.zipCode || null,
    },
  }
}

/** Enlace para que el invitado siga su pedido (estado, comprobante, factura). */
export const guestOrderLink = (orderId) => {
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '')
  return `${base}/pedido?orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(signGuestToken(orderId))}`
}
