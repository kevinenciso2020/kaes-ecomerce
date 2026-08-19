import multer from 'multer'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import crypto from 'crypto'
import { fileTypeFromFile } from 'file-type'

const TMP_DIR = path.join(os.tmpdir(), 'ecommerce-uploads')
await fs.mkdir(TMP_DIR, { recursive: true })

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_EXT  = new Set(['jpg', 'jpeg', 'png', 'webp'])
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_FILES = 10

const storage = multer.diskStorage({
  destination: TMP_DIR,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${crypto.randomUUID()}`)
  },
})

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    const err = new Error(`Tipo de archivo no permitido: ${file.mimetype}. Solo se permiten imágenes JPG, PNG o WEBP.`)
    err.status = 400
    err.code = 'UNSUPPORTED_FILE_TYPE'
    return cb(err)
  }
  cb(null, true)
}

export const productUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: 20,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024,
  },
})

export const verifyMagicNumbers = async (files) => {
  if (!files?.length) return files
  for (const file of files) {
    const real = await fileTypeFromFile(file.path)
    if (!real || !ALLOWED_EXT.has(real.ext)) {
      await fs.unlink(file.path).catch(() => {})
      throw Object.assign(
        new Error(`Contenido del archivo "${file.originalname}" no coincide con un formato de imagen permitido.`),
        { status: 400, code: 'INVALID_FILE_CONTENT' }
      )
    }
  }
  return files
}

export const cleanupTempFiles = async (files) => {
  if (!files?.length) return
  await Promise.allSettled(files.map(f => fs.unlink(f.path).catch(() => {})))
}

export const uploadConstants = {
  ALLOWED_MIME,
  ALLOWED_EXT,
  MAX_FILE_SIZE,
  MAX_FILES,
}
