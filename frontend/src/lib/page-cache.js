// Caché de páginas públicas en el borde de Cloudflare (Cache API).
//
// Reemplaza al CDN de Vercel: las páginas del catálogo declaran
// `Cache-Control: public, s-maxage=N` y aquí se guardan N segundos en
// `caches.default`, así la mayoría de visitas no vuelven a pedir el catálogo al
// API ni gastan CPU del Worker renderizando.
//
// Sólo se cachean respuestas GET 200, con `s-maxage`, sin `Set-Cookie` y fuera
// de /admin. La clave es la URL completa (los filtros de /productos van en la
// query). Si `caches` no existe (astro dev, tests) no se hace nada.
//
// Ojo: la Cache API sólo funciona en un dominio propio, no en *.workers.dev.

import { isAdminPath } from './security-headers.js'

export const CACHE_STATUS_HEADER = 'x-kaes-cache'
// Guarda el Cache-Control original de la página: a la Cache API se le da un
// max-age explícito y al servir desde caché se restaura el original.
const ORIGINAL_CC_HEADER = 'x-kaes-original-cache-control'

const getEdgeCache = () => globalThis.caches?.default ?? null

export const sMaxAge = (cacheControl) => {
  const match = /(?:^|,)\s*s-maxage=(\d+)/i.exec(cacheControl || '')
  return match ? Number(match[1]) : 0
}

export const isCacheableRequest = (request, url) =>
  request.method === 'GET' && !request.headers.has('range') && !isAdminPath(url.pathname)

export const isCacheableResponse = (response) =>
  response.status === 200 &&
  !response.headers.has('set-cookie') &&
  sMaxAge(response.headers.get('cache-control')) > 0

const cacheKey = (url) => new Request(url.toString(), { method: 'GET' })

const markStatus = (response, status) => {
  try {
    response.headers.set(CACHE_STATUS_HEADER, status)
    return response
  } catch {
    const copy = new Response(response.body, response)
    copy.headers.set(CACHE_STATUS_HEADER, status)
    return copy
  }
}

// Busca la página en caché. Devuelve la respuesta (marcada HIT) o null.
export const readCachedPage = async (request, url) => {
  const cache = getEdgeCache()
  if (!cache || !isCacheableRequest(request, url)) return null
  try {
    const cached = await cache.match(cacheKey(url))
    if (!cached) return null
    const response = new Response(cached.body, cached)
    const original = response.headers.get(ORIGINAL_CC_HEADER)
    if (original) response.headers.set('Cache-Control', original)
    response.headers.delete(ORIGINAL_CC_HEADER)
    response.headers.delete('age')
    response.headers.set(CACHE_STATUS_HEADER, 'HIT')
    return response
  } catch (err) {
    console.error('page-cache.read_failed', err)
    return null
  }
}

// Guarda la página si es cacheable. `waitUntil` (del contexto del Worker)
// permite responder sin esperar a que termine de guardarse; sin él se espera.
export const storePage = async (request, url, response, waitUntil) => {
  const cache = getEdgeCache()
  if (!cache || !isCacheableRequest(request, url) || !isCacheableResponse(response)) return response

  const original = response.headers.get('cache-control')
  const copy = new Response(response.clone().body, response)
  copy.headers.set(ORIGINAL_CC_HEADER, original)
  copy.headers.set('Cache-Control', `public, max-age=${sMaxAge(original)}`)

  const put = cache.put(cacheKey(url), copy).catch((err) => console.error('page-cache.store_failed', err))
  if (waitUntil) waitUntil(put)
  else await put
  return markStatus(response, 'MISS')
}
