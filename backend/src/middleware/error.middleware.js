import multer from 'multer'
import { uploadConstants } from './upload.middleware.js'
import { logger } from '../config/logger.js'
import { captureError } from '../config/sentry.js'

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: () => `El archivo excede el tamaño máximo permitido de 5 MB.`,
  LIMIT_FILE_COUNT: () => `Has enviado demasiadas imágenes. El máximo es ${uploadConstants.MAX_FILES} por petición.`,
  LIMIT_UNEXPECTED_FILE: (err) => `Campo de archivo inesperado: "${err.field ?? 'desconocido'}".`,
  LIMIT_FIELD_COUNT: () => `Demasiados campos en el formulario.`,
  LIMIT_FIELD_SIZE: () => `Un campo del formulario excede el tamaño máximo permitido.`,
  LIMIT_FIELD_NAME: () => `El nombre de un campo es demasiado largo.`,
  LIMIT_PART_COUNT: () => `Demasiadas partes en la petición multipart.`,
}

const MULTER_STATUS = {
  LIMIT_FILE_SIZE: 413,
}

const MULTER_FALLBACK_STATUS = 400

const CUSTOM_UPLOAD_STATUS = {
  UNSUPPORTED_FILE_TYPE: 400,
  INVALID_FILE_CONTENT: 400,
}

const resolveMulterMessage = (err) => {
  const factory = MULTER_MESSAGES[err.code]
  return factory ? factory(err) : `Error al procesar el archivo (${err.code}).`
}

const noopLog = { error() {}, warn() {}, info() {}, debug() {}, child: () => noopLog }

// Middleware global de manejo de errores
// Captura cualquier error que llegue aquí desde los controladores
export const errorHandler = (err, req, res, next) => {
  const log = req.log || logger
  const ctx = {
    reqId: req.id,
    method: req.method,
    path: req.path,
    err,
  }

  if (err instanceof multer.MulterError) {
    const status = MULTER_STATUS[err.code] ?? MULTER_FALLBACK_STATUS
    log.warn({ ...ctx, code: err.code, status }, 'request.upload_multer_error')
    return res.status(status).json({ error: resolveMulterMessage(err) })
  }

  // Códigos personalizados del upload.middleware.js (no son MulterError nativos)
  if (CUSTOM_UPLOAD_STATUS[err.code] !== undefined && !err.status && !err.statusCode) {
    log.warn({ ...ctx, code: err.code, status: CUSTOM_UPLOAD_STATUS[err.code] }, 'request.upload_validation_error')
    return res.status(CUSTOM_UPLOAD_STATUS[err.code]).json({
      error: err.message || 'Error de validación de archivo.',
    })
  }

  // Error de validación de Prisma (registro duplicado, etc.)
  if (err.code === 'P2002') {
    log.warn({ ...ctx, code: err.code }, 'request.prisma_unique_violation')
    return res.status(409).json({ error: 'Ya existe un registro con ese valor único' })
  }

  // Error de registro no encontrado en Prisma
  if (err.code === 'P2025') {
    log.warn({ ...ctx, code: err.code }, 'request.prisma_not_found')
    return res.status(404).json({ error: 'Registro no encontrado' })
  }

  // Errores de llamadas HTTP salientes (axios: Wompi, etc.) traen el status
  // del servidor remoto: NO se reenvía al cliente (un 401 de Wompi no significa
  // que la sesión del usuario sea inválida).
  if (err.isAxiosError) {
    log.error({ ...ctx, upstreamStatus: err.response?.status, url: err.config?.url }, 'request.upstream_failed')
    captureError(err, { reqId: req.id, method: req.method, path: req.path, upstreamStatus: err.response?.status })
    return res.status(502).json({ error: 'Un servicio externo no respondió. Intenta de nuevo en unos minutos.' })
  }

  const status = err.status || err.statusCode || 500
  const isServerError = status >= 500
  // En 5xx no se expone el mensaje interno (puede traer detalles de la BD o
  // de un proveedor externo); en 4xx el mensaje es para el usuario.
  const message = isServerError ? 'Error interno del servidor' : (err.message || 'Solicitud inválida')

  if (isServerError) {
    log.error({ ...ctx, status }, 'request.failed')
    captureError(err, { reqId: req.id, method: req.method, path: req.path, status })
  } else {
    log.warn({ ...ctx, status }, 'request.client_error')
  }

  const body = { error: message }
  if (!isServerError && typeof err.code === 'string') body.code = err.code
  if (!isServerError && err.details) body.details = err.details
  res.status(status).json(body)
}

export const _testing = { noopLog }
