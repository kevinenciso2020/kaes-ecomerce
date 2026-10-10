// Misma fórmula que backend/src/services/tax.service.js (aritmética en puntos básicos).
export const finalPrice = (base, rate) => {
  const b = Number(base)
  if (!Number.isFinite(b) || b <= 0) return 0
  return Math.round((b * (10000 + Math.round(Number(rate) * 100))) / 10000)
}

export const formatCOP = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')

// Tope técnico (columnas Decimal(10,2) y IVA ≤ 30 %); debe coincidir con el backend.
export const MAX_BASE_PRICE = 70000000
export const MSG_PRECIO_MAX = 'El precio es demasiado alto para el sistema (máximo $70.000.000)'
