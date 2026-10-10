// Dígito de verificación (DV) del NIT según el algoritmo módulo 11 de la DIAN.
const WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]

export const computeNitDv = (nit) => {
  const digits = String(nit ?? '').replace(/\D/g, '')
  if (!digits || digits.length > WEIGHTS.length) return null
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[digits.length - 1 - i]) * WEIGHTS[i]
  }
  const r = sum % 11
  return String(r > 1 ? 11 - r : r)
}
