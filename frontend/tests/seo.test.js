import { describe, it, expect } from 'vitest'
import {
  absoluteUrl,
  buildRobotsTxt,
  buildSitemapXml,
  isNoIndexPath,
  productJsonLd,
  resolveSiteUrl,
  safeJsonForScript,
  truncateDescription,
} from '../src/lib/seo.js'

describe('resolveSiteUrl / absoluteUrl', () => {
  it('prefiere el dominio configurado y quita la "/" final', () => {
    expect(resolveSiteUrl(new URL('https://kaes-simplyeternal.co/'), 'https://x.vercel.app'))
      .toBe('https://kaes-simplyeternal.co')
  })

  it('sin dominio configurado usa el origen de la petición', () => {
    expect(resolveSiteUrl(undefined, 'https://kaes-ecomerce.vercel.app')).toBe('https://kaes-ecomerce.vercel.app')
  })

  it('arma URLs absolutas', () => {
    expect(absoluteUrl('https://k.co', '/productos')).toBe('https://k.co/productos')
    expect(absoluteUrl('https://k.co', 'productos')).toBe('https://k.co/productos')
  })
})

describe('isNoIndexPath', () => {
  it.each(['/admin', '/admin/ordenes', '/perfil', '/perfil/ordenes/1', '/checkout', '/checkout/resultado', '/carrito', '/auth/login'])(
    '%s es privada', (path) => expect(isNoIndexPath(path)).toBe(true),
  )

  it.each(['/', '/productos', '/productos/camiseta', '/contacto', '/legal/politica-de-privacidad', '/administracion-de-tallas'])(
    '%s es indexable', (path) => expect(isNoIndexPath(path)).toBe(false),
  )
})

describe('robots.txt', () => {
  it('bloquea las zonas privadas y apunta al sitemap absoluto', () => {
    const txt = buildRobotsTxt('https://kaes-simplyeternal.co')
    expect(txt).toContain('User-agent: *')
    expect(txt).toContain('Disallow: /admin')
    expect(txt).toContain('Disallow: /checkout')
    expect(txt).not.toContain('Disallow: /productos')
    expect(txt).toContain('Sitemap: https://kaes-simplyeternal.co/sitemap.xml')
  })
})

describe('sitemap.xml', () => {
  it('incluye páginas fijas y productos con lastmod, y escapa caracteres XML', () => {
    const xml = buildSitemapXml('https://k.co', [
      { slug: 'camiseta-negra', updatedAt: '2026-10-01T10:00:00.000Z' },
      { slug: 'a&b' },
      { slug: null },
    ])
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<loc>https://k.co/</loc>')
    expect(xml).toContain('<loc>https://k.co/productos</loc>')
    expect(xml).toContain('<loc>https://k.co/productos/camiseta-negra</loc><lastmod>2026-10-01T10:00:00.000Z</lastmod>')
    expect(xml).toContain('<loc>https://k.co/productos/a%26b</loc>')
    expect(xml).not.toContain('/admin')
    expect(xml.match(/<url>/g)).toHaveLength(8) // 6 fijas + 2 productos con slug
  })

  it('sin productos (API caída) sigue siendo un sitemap válido', () => {
    const xml = buildSitemapXml('https://k.co', [])
    expect(xml).toContain('</urlset>')
    expect(xml.match(/<url>/g)).toHaveLength(6)
  })
})

describe('truncateDescription', () => {
  it('deja textos cortos igual y normaliza espacios', () => {
    expect(truncateDescription('  Hola\n mundo ')).toBe('Hola mundo')
  })

  it('recorta textos largos sin pasar del máximo', () => {
    const out = truncateDescription('palabra '.repeat(50), 160)
    expect(out.length).toBeLessThanOrEqual(160)
    expect(out.endsWith('…')).toBe(true)
  })

  it('tolera null/undefined', () => {
    expect(truncateDescription(undefined)).toBe('')
  })
})

describe('productJsonLd', () => {
  const product = { name: 'Camiseta', description: 'Algodón', variants: [{ sku: 'CAM-NEG-M' }] }

  it('genera un Product de schema.org con oferta en COP', () => {
    const ld = productJsonLd({ product, url: 'https://k.co/productos/camiseta', image: 'https://res.cloudinary.com/x.jpg', price: 89900.4, inStock: true })
    expect(ld['@type']).toBe('Product')
    expect(ld.sku).toBe('CAM-NEG-M')
    expect(ld.image).toEqual(['https://res.cloudinary.com/x.jpg'])
    expect(ld.offers).toMatchObject({ priceCurrency: 'COP', price: '89900', availability: 'https://schema.org/InStock' })
  })

  it('marca agotado y omite imagen/sku si no hay', () => {
    const ld = productJsonLd({ product: { name: 'X', description: '' }, url: 'u', price: 1, inStock: false })
    expect(ld.offers.availability).toBe('https://schema.org/OutOfStock')
    expect(ld).not.toHaveProperty('image')
    expect(ld).not.toHaveProperty('sku')
  })
})

describe('safeJsonForScript', () => {
  it('no permite cerrar la etiqueta <script> desde los datos', () => {
    const out = safeJsonForScript({ name: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('</script>')
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script>')
  })
})
