// Imágenes de Cloudinary al tamaño justo. Los productos se suben como PNG
// originales (~2 MB); Cloudinary los redimensiona y convierte al vuelo
// (AVIF/WebP según el navegador, calidad automática) si se lo pedimos en la URL.
// URLs de otros orígenes, o recursos privados (`/authenticated/`, p. ej. los
// comprobantes de transferencia), se devuelven sin tocar.

const MARCA = '/image/upload/'

const esCloudinary = (url) =>
  typeof url === 'string' && url.startsWith('https://res.cloudinary.com/') && url.includes(MARCA)

// `c_limit` nunca agranda: si la original es más pequeña, se queda en su tamaño.
export const cloudinaryUrl = (url, { width } = {}) => {
  if (!esCloudinary(url)) return url
  const t = ['f_auto', 'q_auto', 'c_limit', width ? `w_${Math.round(width)}` : null].filter(Boolean).join(',')
  return url.replace(MARCA, `${MARCA}${t}/`)
}

// srcset con varios anchos para que el navegador elija según pantalla y densidad.
export const cloudinarySrcset = (url, widths) =>
  esCloudinary(url) ? widths.map((w) => `${cloudinaryUrl(url, { width: w })} ${w}w`).join(', ') : undefined

// Tamaños usados en la tienda (ancho en px CSS × hasta 2x de densidad).
export const ANCHOS_TARJETA = [320, 480, 640]
export const ANCHOS_PRODUCTO = [480, 800, 1200]
export const ANCHO_MINIATURA = 160
