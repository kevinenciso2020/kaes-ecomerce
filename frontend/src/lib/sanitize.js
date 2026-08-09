export function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '')
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function sanitizeProduct(product) {
  if (!product) return null
  return {
    ...product,
    name: escapeHtml(product.name),
    slug: escapeHtml(product.slug),
    description: escapeHtml(product.description),
  }
}

export function sanitizeCartItem(item) {
  if (!item) return {}
  return {
    ...item,
    name: escapeHtml(item.name),
    size: escapeHtml(item.size),
    color: escapeHtml(item.color),
  }
}

export function sanitizeOrder(order) {
  if (!order) return null
  const sanitizedShipping = order.shippingAddress && typeof order.shippingAddress === 'object'
    ? {
        ...order.shippingAddress,
        street: escapeHtml(order.shippingAddress.street),
        city: escapeHtml(order.shippingAddress.city),
        department: escapeHtml(order.shippingAddress.department),
        departamento: escapeHtml(order.shippingAddress.departamento),
        municipio: escapeHtml(order.shippingAddress.municipio),
        zipCode: escapeHtml(order.shippingAddress.zipCode),
        fullName: escapeHtml(order.shippingAddress.fullName),
        phone: escapeHtml(order.shippingAddress.phone),
        label: escapeHtml(order.shippingAddress.label),
      }
    : order.shippingAddress
  return {
    ...order,
    id: escapeHtml(order.id),
    status: escapeHtml(order.status),
    shippingAddress: sanitizedShipping,
    notes: escapeHtml(order.notes),
  }
}

export function sanitizeUser(user) {
  if (!user) return null
  return {
    ...user,
    name: escapeHtml(user.name),
    email: escapeHtml(user.email),
  }
}

export function sanitizeDiscount(discount) {
  if (!discount) return null
  return {
    ...discount,
    code: escapeHtml(discount.code),
    description: escapeHtml(discount.description),
  }
}