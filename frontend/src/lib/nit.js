// Dígito de verificación (DV) del NIT — algoritmo módulo 11 de la DIAN.
// Mismo cálculo que backend/src/services/einvoice/nit.js.
const WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]

export const computeNitDv = (nit) => {
  const digits = String(nit ?? '').replace(/\D/g, '')
  if (!digits || digits.length > WEIGHTS.length) return ''
  let sum = 0
  for (let i = 0; i < digits.length; i++) sum += Number(digits[digits.length - 1 - i]) * WEIGHTS[i]
  const r = sum % 11
  return String(r > 1 ? 11 - r : r)
}

export const BUYER_DOC_TYPES = [
  { value: '13', label: 'Cédula de ciudadanía' },
  { value: '31', label: 'NIT' },
  { value: '22', label: 'Cédula de extranjería' },
  { value: '41', label: 'Pasaporte' },
  { value: '47', label: 'PEP' },
  { value: '48', label: 'PPT' },
]

/** Valida y arma el bloque `buyer` del pedido. Devuelve { buyer } o { error }. */
export const buildBuyer = ({ docType, docNumber, name }) => {
  let number = String(docNumber ?? '').replace(/[.\s]/g, '')
  const cleanName = String(name ?? '').trim()
  if (!BUYER_DOC_TYPES.some((t) => t.value === docType)) return { error: 'Selecciona el tipo de documento.' }
  if (docType === '31') {
    // Es común escribir el NIT con su DV ("900123456-7"): se separa y se valida.
    const m = /^(\d+)-(\d)$/.exec(number)
    if (m) {
      if (computeNitDv(m[1]) !== m[2]) return { error: 'El dígito de verificación no corresponde al NIT.' }
      number = m[1]
    }
  }
  const alphanumeric = ['41', '47', '48'].includes(docType)
  if (alphanumeric ? !/^[A-Za-z0-9]{3,20}$/.test(number) : !/^[1-9]\d{4,14}$/.test(number)) {
    return { error: 'Ingresa un número de documento válido (sin puntos ni dígito de verificación).' }
  }
  if (cleanName.length < 3) return { error: docType === '31' ? 'Ingresa la razón social.' : 'Ingresa el nombre completo para la factura.' }
  return {
    buyer: {
      docType,
      docNumber: number,
      name: cleanName,
      ...(docType === '31' ? { dv: computeNitDv(number) } : {}),
    },
  }
}
