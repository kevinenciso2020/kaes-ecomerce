import { api } from '../lib/api.js'
import { buildSitemapXml, resolveSiteUrl } from '../lib/seo.js'

const PAGE_SIZE = 48 // máximo que acepta GET /products
const MAX_PAGES = 20

// Recorre el catálogo público paginado. Si el API falla se publica igual el
// sitemap con las páginas fijas (mejor eso que un 500 para Google).
const fetchAllProducts = async () => {
  const products = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await api.products.list({ page, limit: PAGE_SIZE })
    products.push(...(data?.products || []))
    if (page >= (data?.pagination?.totalPages || 1)) break
  }
  return products
}

export const GET = async ({ site, url }) => {
  let products = []
  try {
    products = await fetchAllProducts()
  } catch (err) {
    console.error('sitemap: no se pudo cargar el catálogo', err)
  }

  return new Response(buildSitemapXml(resolveSiteUrl(site, url.origin), products), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
