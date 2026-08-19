import multer from 'multer'
import { uploadConstants } from './upload.middleware.js'

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

// Middleware global de manejo de errores
// Captura cualquier error que llegue aquí desde los controladores
export const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message)

  if (err instanceof multer.MulterError) {
    const status = MULTER_STATUS[err.code] ?? MULTER_FALLBACK_STATUS
    return res.status(status).json({ error: resolveMulterMessage(err) })
  }

  // Códigos personalizados del upload.middleware.js (no son MulterError nativos)
  if (CUSTOM_UPLOAD_STATUS[err.code] !== undefined && !err.status && !err.statusCode) {
    return res.status(CUSTOM_UPLOAD_STATUS[err.code]).json({
      error: err.message || 'Error de validación de archivo.',
    })
  }

  // Error de validación de Prisma (registro duplicado, etc.)
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Ya existe un registro con ese valor único' })
  }

  // Error de registro no encontrado en Prisma
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Registro no encontrado' })
  }

  const status = err.status || err.statusCode || 500
  const message = err.message || 'Error interno del servidor'

  res.status(status).json({ error: message })
}
