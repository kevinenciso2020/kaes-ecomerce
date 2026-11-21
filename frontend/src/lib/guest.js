// Compra como invitado: el servidor devuelve un token que da acceso SOLO a ese
// pedido. Se guarda en el navegador (no hay cuenta ni fila en la BD).

const KEY = 'kaes_guest_orders'
const MAX_ORDERS = 20

const read = () => {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}')
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

export const saveGuestToken = (orderId, token) => {
  if (!orderId || !token) return
  try {
    const data = read()
    delete data[orderId] // reinsertar al final = más reciente
    data[orderId] = token
    const ids = Object.keys(data)
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_ORDERS))) delete data[id]
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch { /* almacenamiento bloqueado: el enlace del correo sigue sirviendo */ }
}

export const getGuestToken = (orderId) => (orderId ? read()[orderId] || null : null)

/** Cabecera x-guest-token si hay token guardado para esa orden. */
export const guestHeaders = (orderId) => {
  const token = getGuestToken(orderId)
  return token ? { 'x-guest-token': token } : {}
}
