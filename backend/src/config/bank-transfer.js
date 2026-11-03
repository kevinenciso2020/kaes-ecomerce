// Transferencia manual (sin pasarela, sin comisión): el cliente transfiere a
// las cuentas de la tienda y sube el comprobante; un admin lo aprueba.
//
// Variables (todas opcionales salvo BANK_TRANSFER_ENABLED=true y al menos una cuenta):
//   BANK_TRANSFER_ENABLED            true para mostrarla en el checkout
//   BANK_TRANSFER_HOLDER_NAME        titular de las cuentas
//   BANK_TRANSFER_HOLDER_DOC         cédula o NIT del titular
//   BANK_TRANSFER_NEQUI              número celular de Nequi
//   BANK_TRANSFER_BANCOLOMBIA_TYPE   Ahorros | Corriente
//   BANK_TRANSFER_BANCOLOMBIA_NUMBER número de cuenta Bancolombia
//   BANK_TRANSFER_BREB_KEY           llave Bre-B (celular, cédula, correo o alfanumérica)

const env = (key) => (process.env[key] || '').trim()

export const getTransferAccounts = () => {
  const accounts = []
  if (env('BANK_TRANSFER_NEQUI')) {
    accounts.push({ type: 'NEQUI', label: 'Nequi', number: env('BANK_TRANSFER_NEQUI') })
  }
  if (env('BANK_TRANSFER_BANCOLOMBIA_NUMBER')) {
    accounts.push({
      type: 'BANCOLOMBIA',
      label: `Bancolombia ${env('BANK_TRANSFER_BANCOLOMBIA_TYPE') || 'Ahorros'}`,
      number: env('BANK_TRANSFER_BANCOLOMBIA_NUMBER'),
    })
  }
  if (env('BANK_TRANSFER_BREB_KEY')) {
    accounts.push({ type: 'BREB', label: 'Llave Bre-B', number: env('BANK_TRANSFER_BREB_KEY') })
  }
  return accounts
}

export const getTransferHolder = () => ({
  name: env('BANK_TRANSFER_HOLDER_NAME') || null,
  document: env('BANK_TRANSFER_HOLDER_DOC') || null,
})

export const isTransferConfigured = () =>
  process.env.BANK_TRANSFER_ENABLED === 'true' && getTransferAccounts().length > 0
