// Cálculo de IVA. Funciones puras: sin Prisma ni red.
// Aritmética en puntos básicos (tasa × 100) para evitar errores de coma flotante.

export const GENERAL_RATE = 19
export const MAX_RATE = 30

export const isValidRate = (rate) =>
  typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= MAX_RATE

const basisPoints = (rate) => Math.round(rate * 100)

/** Precio final con IVA, en pesos enteros. */
export const finalPrice = (base, rate) =>
  Math.round((Number(base) * (10000 + basisPoints(rate))) / 10000)

/** Precio base (sin IVA) a partir de un precio final. Dos decimales. */
export const basePriceFromFinal = (final, rate) =>
  Math.round((Number(final) * 10000 * 100) / (10000 + basisPoints(rate))) / 100
