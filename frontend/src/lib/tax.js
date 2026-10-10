// Misma fórmula que backend/src/services/tax.service.js (aritmética en puntos básicos).
export const finalPrice = (base, rate) => {
  const b = Number(base)
  if (!Number.isFinite(b) || b <= 0) return 0
  return Math.round((b * (10000 + Math.round(Number(rate) * 100))) / 10000)
}

// Desglose de un precio final (con IVA): { base, iva, total } en pesos enteros.
// Inversa de finalPrice: base = total / (1 + tasa); iva = total - base (la suma siempre da el total).
export const ivaBreakdown = (total, rate) => {
  const t = Math.round(Number(total))
  if (!Number.isFinite(t) || t <= 0) return { base: 0, iva: 0, total: 0 }
  const base = Math.round((t * 10000) / (10000 + Math.round((Number(rate) || 0) * 100)))
  return { base, iva: t - base, total: t }
}

export const formatCOP = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')

// Tope técnico (columnas Decimal(10,2) y IVA ≤ 30 %); debe coincidir con el backend.
export const MAX_BASE_PRICE = 70000000
export const MSG_PRECIO_MAX = 'El precio es demasiado alto para el sistema (máximo $70.000.000)'
