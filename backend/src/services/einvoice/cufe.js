// CUFE / CUDE y código de seguridad del software (Anexo Técnico 1.9, numeral 11).
import { createHash } from 'node:crypto'

const sha384 = (s) => createHash('sha384').update(s, 'utf8').digest('hex')

/**
 * CUFE (factura) = SHA-384(NumFac + FecFac + HorFac + ValFac + 01 + ValImp1 + 04 +
 * ValImp2 + 03 + ValImp3 + ValTot + NitOFE + NumAdq + ClTec + TipoAmbiente).
 * Para la nota crédito (CUDE) en lugar de la clave técnica va el PIN del software.
 * Todos los montos con 2 decimales y punto.
 */
const documentKey = ({ number, issueDate, issueTime, lineExtension, taxIva, taxInc = '0.00', taxIca = '0.00', payable, supplierNit, customerId, secret, environment }) =>
  sha384(
    `${number}${issueDate}${issueTime}${lineExtension}01${taxIva}04${taxInc}03${taxIca}${payable}${supplierNit}${customerId}${secret}${environment}`,
  )

export const computeCufe = ({ technicalKey, ...rest }) => documentKey({ ...rest, secret: technicalKey })
export const computeCude = ({ softwarePin, ...rest }) => documentKey({ ...rest, secret: softwarePin })

/** SoftwareSecurityCode = SHA-384(SoftwareID + PIN + número del documento con prefijo). */
export const softwareSecurityCode = (softwareId, pin, documentNumber) =>
  sha384(`${softwareId}${pin}${documentNumber}`)

/** URL de consulta para el QR (numeral 11.3.1). Ambiente 1 = producción, 2 = habilitación. */
export const qrUrl = (environment, key) =>
  `https://catalogo-vpfe${String(environment) === '1' ? '' : '-hab'}.dian.gov.co/document/searchqr?documentkey=${key}`
