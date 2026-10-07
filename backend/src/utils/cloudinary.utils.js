import cloudinary from '../config/cloudinary.js'
import { verifyMagicNumbers, cleanupTempFiles } from '../middleware/upload.middleware.js'
import { logger } from '../config/logger.js'

const log = logger.child({ component: 'cloudinary' })

export const PRODUCT_FOLDER = 'ecommerce-ropa/products'

const badRequest = (message) => Object.assign(new Error(message), { status: 400 })

// Parámetros de transformación de Cloudinary (prefijo antes de "_").
const TRANSFORM_KEYS = new Set([
  'a', 'ac', 'af', 'ar', 'b', 'bo', 'br', 'c', 'co', 'cs', 'd', 'dl', 'dn', 'dpr', 'du', 'e', 'eo',
  'f', 'fl', 'fn', 'fps', 'g', 'h', 'if', 'ki', 'l', 'o', 'p', 'pg', 'q', 'r', 's', 'so', 'sp',
  't', 'u', 'vc', 'vs', 'w', 'x', 'y', 'z',
])
const isTransformationSegment = (segment) =>
  segment.split(',').every((token) => {
    const idx = token.indexOf('_')
    return idx > 0 && TRANSFORM_KEYS.has(token.slice(0, idx))
  })

/**
 * Valida una URL de imagen de Cloudinary y extrae su public_id.
 *   https://res.cloudinary.com/<cloud>/image/upload/[transformaciones/][v123/]<carpeta>/<id>.<ext>
 * Si la imagen pertenece a nuestra cuenta (CLOUDINARY_CLOUD_NAME) devuelve el
 * publicId para poder borrarla luego; si es de otra cuenta, publicId = ''.
 */
export const parseCloudinaryUrl = (rawUrl) => {
  let url
  try {
    url = new URL(String(rawUrl).trim())
  } catch {
    throw badRequest(`URL de imagen inválida: ${rawUrl}`)
  }
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') {
    throw badRequest('Solo se aceptan URLs https://res.cloudinary.com/…')
  }

  const parts = url.pathname.split('/').filter(Boolean)
  // [cloud, 'image', 'upload', ...rest]
  if (parts.length < 4 || parts[1] !== 'image' || parts[2] !== 'upload') {
    throw badRequest('La URL debe ser de una imagen de Cloudinary (…/image/upload/…)')
  }
  const cloud = parts[0]
  let rest = parts.slice(3)
  // Quitar segmentos de transformación (w_800,c_fill/q_auto…) y la versión v123
  while (rest.length > 1 && isTransformationSegment(rest[0])) rest = rest.slice(1)
  if (rest.length > 1 && /^v\d+$/.test(rest[0])) rest = rest.slice(1)

  const last = rest[rest.length - 1] || ''
  if (!/\.(jpe?g|png|webp|avif|gif)$/i.test(last) && !/^[\w-]+$/.test(last)) {
    throw badRequest('La URL no parece ser una imagen')
  }
  const publicId = rest.join('/').replace(/\.[a-z0-9]+$/i, '')
  const isOwn = cloud === process.env.CLOUDINARY_CLOUD_NAME

  return { url: url.toString(), publicId: isOwn ? decodeURIComponent(publicId) : '' }
}

export const parseImageUrls = (value) => {
  if (value === undefined || value === null || value === '') return []
  let list = value
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value)
    } catch {
      list = value.split(/[\n,]/)
    }
  }
  if (!Array.isArray(list)) throw badRequest('imageUrls debe ser una lista de URLs')
  const urls = list.map((u) => String(u).trim()).filter(Boolean)
  if (urls.length > MAX_IMAGE_URLS) throw badRequest(`Máximo ${MAX_IMAGE_URLS} URLs de imágenes por solicitud`)
  return urls.map(parseImageUrl)
}

const MAX_IMAGE_URLS = 10
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*|\[.*\])$/i

/**
 * Valida una URL de imagen. Las de res.cloudinary.com se guardan tal cual;
 * cualquier otra URL https pública se marca `remote: true` para que Cloudinary
 * la descargue y la aloje (ver importRemoteImages).
 */
const parseImageUrl = (rawUrl) => {
  let url
  try {
    url = new URL(String(rawUrl).trim())
  } catch {
    throw badRequest(`URL de imagen inválida: ${rawUrl}`)
  }
  if (url.protocol !== 'https:') throw badRequest('Las URLs de imágenes deben usar https')
  if (url.hostname === 'res.cloudinary.com') return parseCloudinaryUrl(rawUrl)
  if (url.username || url.password || PRIVATE_HOST.test(url.hostname) || !url.hostname.includes('.')) {
    throw badRequest('URL de imagen no permitida')
  }
  return { url: url.toString(), publicId: '', remote: true }
}

/**
 * Pide a Cloudinary que descargue y aloje las imágenes remotas. Devuelve la
 * lista final y `uploadedIds` (public_id nuevos, para revertir si la BD falla).
 */
export const importRemoteImages = async (images = []) => {
  const uploadedIds = []
  try {
    const result = await Promise.all(
      images.map(async (img) => {
        if (!img.remote) return img
        try {
          const r = await cloudinary.uploader.upload(img.url, {
            folder: PRODUCT_FOLDER,
            transformation: [{ width: 1200, height: 1500, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
          })
          uploadedIds.push(r.public_id)
          return { url: r.secure_url, publicId: r.public_id }
        } catch (err) {
          log.warn({ url: img.url, err: err?.message }, 'cloudinary.remote_upload_failed')
          throw badRequest(`Cloudinary no pudo cargar la imagen: ${img.url}`)
        }
      }),
    )
    return { images: result, uploadedIds }
  } catch (err) {
    await destroyImages(uploadedIds)
    throw err
  }
}

/**
 * Sube archivos (multer) a Cloudinary. Se hace FUERA de la transacción de BD:
 * las subidas pueden tardar varios segundos y las transacciones interactivas
 * de Prisma tienen timeout de 5 s.
 */
export const uploadProductFiles = async (files = []) => {
  if (!files?.length) return []
  try {
    await verifyMagicNumbers(files)
    return await Promise.all(
      files.map((file) =>
        cloudinary.uploader
          .upload(file.path, {
            folder: PRODUCT_FOLDER,
            transformation: [{ width: 1200, height: 1500, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
          })
          .then((r) => ({ url: r.secure_url, publicId: r.public_id })),
      ),
    )
  } finally {
    await cleanupTempFiles(files)
  }
}

/** Borra imágenes de Cloudinary sin fallar si alguna no existe. */
export const destroyImages = async (publicIds = []) => {
  const ids = publicIds.filter(Boolean)
  if (!ids.length) return
  const results = await Promise.allSettled(ids.map((id) => cloudinary.uploader.destroy(id)))
  results.forEach((r, i) => {
    if (r.status === 'rejected') log.warn({ publicId: ids[i], err: r.reason?.message }, 'cloudinary.destroy_failed')
  })
}
