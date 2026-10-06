import { buildRobotsTxt, resolveSiteUrl } from '../lib/seo.js'

export const GET = ({ site, url }) =>
  new Response(buildRobotsTxt(resolveSiteUrl(site, url.origin)), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=86400',
    },
  })
