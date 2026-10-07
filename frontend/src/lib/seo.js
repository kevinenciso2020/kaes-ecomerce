/**
 * Utilidades de SEO: URL canónica, noindex, robots.txt, sitemap y datos
 * estructurados (schema.org). Funciones puras para poder testearlas.
 */

// Páginas privadas o transaccionales: no deben aparecer en buscadores.
export const PRIVATE_PATH_PREFIXES = ['/admin', '/perfil', '/checkout', '/carrito', '/auth']

// Páginas públicas fijas que van en el sitemap.
export const STATIC_PATHS = [
  '/',
  '/productos',
  '/contacto',
  '/legal/terminos-y-condiciones',
  '/legal/politica-de-privacidad',
  '/legal/politica-de-devoluciones',
]

const matchesPrefix = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)

export const isNoIndexPath = (pathname = '/') =>
  PRIVATE_PATH_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))

/**
 * URL base del sitio sin "/" final. Usa `site` (SITE_URL en astro.config) si
 * está configurado; si no, el origen de la petición actual.
 */
export const resolveSiteUrl = (site, requestOrigin) => {
  const base = site ? String(site) : requestOrigin
  return String(base || '').replace(/\/+$/, '')
}

export const absoluteUrl = (siteUrl, pathname = '/') =>
  `${siteUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`

/** Recorta un texto para meta description (~160 caracteres, sin cortar palabras). */
export const truncateDescription = (text, max = 160) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export const buildRobotsTxt = (siteUrl) =>
  [
    'User-agent: *',
    'Allow: /',
    ...PRIVATE_PATH_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
    '',
    `Sitemap: ${absoluteUrl(siteUrl, '/sitemap.xml')}`,
    '',
  ].join('\n')

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const toIsoDate = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
}

/** products: [{ slug, updatedAt? }] */
export const buildSitemapXml = (siteUrl, products = []) => {
  const entries = [
    ...STATIC_PATHS.map((path) => ({ loc: absoluteUrl(siteUrl, path) })),
    ...products
      .filter((p) => p?.slug)
      .map((p) => ({
        loc: absoluteUrl(siteUrl, `/productos/${encodeURIComponent(p.slug)}`),
        lastmod: toIsoDate(p.updatedAt),
      })),
  ]
  const urls = entries
    .map((e) => `  <url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

/** Datos estructurados schema.org/Product para la ficha de producto. */
export const productJsonLd = ({ product, url, image, price, inStock }) => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: product.name,
  description: truncateDescription(product.description, 500),
  ...(image ? { image: [image] } : {}),
  ...(product.variants?.[0]?.sku ? { sku: product.variants[0].sku } : {}),
  brand: { '@type': 'Brand', name: 'KAES' },
  offers: {
    '@type': 'Offer',
    url,
    priceCurrency: 'COP',
    price: Number(price).toFixed(0),
    availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    itemCondition: 'https://schema.org/NewCondition',
  },
})

/** JSON seguro para incrustar en <script>: escapa "<" para que nada cierre la etiqueta. */
export const safeJsonForScript = (data) => JSON.stringify(data).replace(/</g, '\\u003c')
