// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { onRequest } from '../src/middleware.js'
import { SECURITY_HEADERS, applySecurityHeaders } from '../src/lib/security-headers.js'
import { sMaxAge, readCachedPage, storePage } from '../src/lib/page-cache.js'

const CATALOG_CC = 'public, s-maxage=60, stale-while-revalidate=300'

// Cache API mínima en memoria, como caches.default de Cloudflare.
const createEdgeCache = () => {
  const store = new Map()
  return {
    store,
    match: vi.fn(async (req) => store.get(req.url)?.clone()),
    put: vi.fn(async (req, res) => {
      store.set(req.url, new Response(await res.arrayBuffer(), res))
    }),
  }
}

const page = (body = '<h1>catálogo</h1>', headers = { 'Cache-Control': CATALOG_CC }) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/html', ...headers } })

const makeContext = (path, { method = 'GET', cookie, waitUntil } = {}) => {
  const url = new URL(path, 'https://kaes-simplyeternal.co')
  const headers = new Headers(cookie ? { cookie } : {})
  return {
    url,
    request: new Request(url, { method, headers }),
    locals: waitUntil ? { cfContext: { waitUntil } } : {},
    redirect: (location, status = 302) => new Response(null, { status, headers: { Location: location } }),
  }
}

describe('security-headers', () => {
  it('aplica las cabeceras de seguridad a cualquier página', () => {
    const res = applySecurityHeaders(page(), '/productos')
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(key)).toBe(value)
    }
    expect(res.headers.get('Cache-Control')).toBe(CATALOG_CC)
  })

  it('en /admin añade no-store y noindex', () => {
    const res = applySecurityHeaders(page(), '/admin/ordenes')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('funciona con respuestas de cabeceras inmutables', () => {
    const res = applySecurityHeaders(Response.redirect('https://kaes-simplyeternal.co/', 301), '/')
    expect(res.status).toBe(301)
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })
})

describe('page-cache', () => {
  let cache
  beforeEach(() => {
    cache = createEdgeCache()
    globalThis.caches = { default: cache }
  })
  afterEach(() => {
    delete globalThis.caches
  })

  it('lee s-maxage del Cache-Control', () => {
    expect(sMaxAge(CATALOG_CC)).toBe(60)
    expect(sMaxAge('public, max-age=60')).toBe(0)
    expect(sMaxAge(null)).toBe(0)
  })

  it('guarda una página cacheable y luego la sirve como HIT con su Cache-Control original', async () => {
    const { request, url } = makeContext('/productos?genero=mujer')
    const miss = await storePage(request, url, page(), undefined)
    expect(miss.headers.get('x-kaes-cache')).toBe('MISS')
    expect(await miss.text()).toBe('<h1>catálogo</h1>')

    const stored = cache.put.mock.calls[0][1]
    expect(stored.headers.get('Cache-Control')).toBe('public, max-age=60')

    const hit = await readCachedPage(request, url)
    expect(hit.headers.get('x-kaes-cache')).toBe('HIT')
    expect(hit.headers.get('Cache-Control')).toBe(CATALOG_CC)
    expect(hit.headers.has('x-kaes-original-cache-control')).toBe(false)
    expect(await hit.text()).toBe('<h1>catálogo</h1>')
  })

  it('la query forma parte de la clave', async () => {
    const a = makeContext('/productos?genero=mujer')
    await storePage(a.request, a.url, page(), undefined)
    const b = makeContext('/productos?genero=hombre')
    expect(await readCachedPage(b.request, b.url)).toBeNull()
  })

  it.each([
    ['sin s-maxage', page('x', { 'Cache-Control': 'no-cache' })],
    ['con Set-Cookie', page('x', { 'Cache-Control': CATALOG_CC, 'Set-Cookie': 'a=1' })],
    ['con estado 404', new Response('x', { status: 404, headers: { 'Cache-Control': CATALOG_CC } })],
  ])('no guarda respuestas %s', async (_, response) => {
    const { request, url } = makeContext('/productos')
    const res = await storePage(request, url, response, undefined)
    expect(cache.put).not.toHaveBeenCalled()
    expect(res.headers.has('x-kaes-cache')).toBe(false)
  })

  it('no guarda ni lee /admin ni peticiones que no son GET', async () => {
    const admin = makeContext('/admin')
    await storePage(admin.request, admin.url, page(), undefined)
    const post = makeContext('/productos', { method: 'POST' })
    await storePage(post.request, post.url, page(), undefined)
    expect(cache.put).not.toHaveBeenCalled()
    expect(await readCachedPage(admin.request, admin.url)).toBeNull()
    expect(cache.match).not.toHaveBeenCalled()
  })

  it('usa waitUntil cuando el Worker lo ofrece', async () => {
    const waitUntil = vi.fn()
    const { request, url } = makeContext('/')
    await storePage(request, url, page(), waitUntil)
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('sin Cache API (dev/tests) no hace nada', async () => {
    delete globalThis.caches
    const { request, url } = makeContext('/productos')
    const res = await storePage(request, url, page(), undefined)
    expect(res.headers.has('x-kaes-cache')).toBe(false)
    expect(await readCachedPage(request, url)).toBeNull()
  })
})

describe('middleware onRequest', () => {
  let cache
  beforeEach(() => {
    cache = createEdgeCache()
    globalThis.caches = { default: cache }
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    delete globalThis.caches
    vi.unstubAllGlobals()
    delete process.env.ADMIN_SSR_GUARD
  })

  it('redirige www al dominio principal conservando ruta y query', async () => {
    const ctx = makeContext('https://www.kaes-simplyeternal.co/productos?genero=mujer')
    const next = vi.fn()
    const res = await onRequest(ctx, next)
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('https://kaes-simplyeternal.co/productos?genero=mujer')
    expect(next).not.toHaveBeenCalled()
  })

  it('la segunda visita al catálogo sale de caché sin renderizar', async () => {
    const next = vi.fn(async () => page())
    const first = await onRequest(makeContext('/productos'), next)
    expect(first.headers.get('x-kaes-cache')).toBe('MISS')
    expect(first.headers.get('X-Frame-Options')).toBe('DENY')

    const second = await onRequest(makeContext('/productos'), next)
    expect(second.headers.get('x-kaes-cache')).toBe('HIT')
    expect(second.headers.get('X-Frame-Options')).toBe('DENY')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('/admin sin cookie en modo strict redirige al login con no-store', async () => {
    process.env.ADMIN_SSR_GUARD = 'strict'
    const next = vi.fn()
    const res = await onRequest(makeContext('/admin/ordenes'), next)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/auth/login?redirect=%2Fadmin%2Fordenes')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(next).not.toHaveBeenCalled()
  })

  it('/admin sin cookie fuera de strict deja pasar (valida el cliente)', async () => {
    const next = vi.fn(async () => page('<h1>panel</h1>', {}))
    const res = await onRequest(makeContext('/admin'), next)
    expect(res.status).toBe(200)
    expect(next).toHaveBeenCalledTimes(1)
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('/admin con sesión de cliente (no admin) redirige al inicio', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ user: { role: 'CUSTOMER' } }), { status: 200 }))
    const res = await onRequest(makeContext('/admin', { cookie: 'accessToken=abc' }), vi.fn())
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/')
    expect(fetch.mock.calls[0][1].headers.cookie).toBe('accessToken=abc')
  })

  it('/admin con sesión de admin renderiza y llena locals', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ user: { role: 'SUPER_ADMIN' } }), { status: 200 }))
    const ctx = makeContext('/admin', { cookie: 'accessToken=abc' })
    const next = vi.fn(async () => page('<h1>panel</h1>', {}))
    const res = await onRequest(ctx, next)
    expect(res.status).toBe(200)
    expect(ctx.locals.isAdmin).toBe(true)
    expect(ctx.locals.isSuperAdmin).toBe(true)
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })
})
