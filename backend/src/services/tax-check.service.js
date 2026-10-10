import { isValidRate } from './tax.service.js'

const decodeEntities = (s) =>
  s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

const toPlainText = (html) =>
  decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()

/**
 * Extrae la tarifa general del IVA del texto del art. 468 del Estatuto Tributario.
 * Es deliberadamente estricto: ante cualquier duda devuelve null (el job no hace nada).
 */
export const parseGeneralRate = (html) => {
  const text = toPlainText(html)
  const start = text.search(/articulo 468\./)
  if (start === -1) return null
  // Sólo se mira el tramo del propio artículo (hasta el siguiente "articulo NNN.").
  const rest = text.slice(start + 12)
  const next = rest.search(/articulo \d+\./)
  const article = next === -1 ? rest.slice(0, 1500) : rest.slice(0, next)

  const m = article.match(/tarifa general del impuesto sobre las ventas es del [^()]{0,80}\(\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*%\s*\)/)
  if (!m) return null
  const rate = Number(m[1].replace(',', '.'))
  return isValidRate(rate) ? rate : null
}
