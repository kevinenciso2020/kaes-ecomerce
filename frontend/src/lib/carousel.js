// Lógica del carrusel de productos de la home (sin dependencias de UI para
// poder probarla). La disponibilidad sigue la misma regla que la página de
// producto (src/pages/productos/[slug].astro): con variantes manda la suma de
// su stock; sin variantes, el stock del producto.

const variantsOf = (product) => (Array.isArray(product?.variants) ? product.variants : [])

export const totalStock = (product) => {
  const variants = variantsOf(product)
  if (variants.length > 0) return variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0)
  return Number(product?.stock) || 0
}

export const isAvailable = (product) => Boolean(product?.slug) && totalStock(product) > 0

const ORDEN_TALLAS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
const rankTalla = (talla) => {
  const i = ORDEN_TALLAS.indexOf(String(talla).toUpperCase())
  return i === -1 ? ORDEN_TALLAS.length : i
}

// Tallas con stock, sin repetir y en orden natural (S, M, L…; numéricas al final).
export const availableSizes = (product) => {
  const tallas = new Set(
    variantsOf(product).filter((v) => v.size && Number(v.stock) > 0).map((v) => v.size),
  )
  return [...tallas].sort((a, b) => rankTalla(a) - rankTalla(b) || String(a).localeCompare(String(b), 'es', { numeric: true }))
}

// Colores con stock, sin repetir, en el orden en que llegan.
export const availableColors = (product) => [
  ...new Set(variantsOf(product).filter((v) => v.color && Number(v.stock) > 0).map((v) => v.color)),
]

// Precio a mostrar: finalPrice ya trae el mejor descuento vigente (calculado en el backend).
export const priceInfo = (product) => {
  const price = Number(product?.price) || 0
  const final = Number(product?.finalPrice ?? price)
  const hasOffer = final < price
  return {
    price,
    final,
    hasOffer,
    offerPct: hasOffer && price > 0 ? Math.round((1 - final / price) * 100) : 0,
  }
}

export const shuffle = (items, rng = Math.random) => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Orden aleatorio que además alterna categorías: se barajan los productos de
// cada categoría y el orden de las categorías, y luego se intercalan, para que
// no salgan seguidos varios del mismo tipo.
export const shuffleMixed = (products, rng = Math.random) => {
  const grupos = new Map()
  for (const p of products) {
    const clave = p?.category?.slug ?? ''
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave).push(p)
  }
  const colas = shuffle([...grupos.values()], rng).map((g) => shuffle(g, rng))
  const out = []
  while (colas.some((c) => c.length > 0)) {
    for (const c of colas) if (c.length > 0) out.push(c.shift())
  }
  return out
}

// Para el desplazamiento continuo cada "vuelta" debe ser más ancha que la
// pantalla: con pocos productos se repite la lista hasta tener al menos
// `minItems` tarjetas.
export const repeatToFill = (items, minItems = 12) => {
  if (items.length === 0) return []
  const veces = Math.max(1, Math.ceil(minItems / items.length))
  return Array.from({ length: veces }, () => items).flat()
}
