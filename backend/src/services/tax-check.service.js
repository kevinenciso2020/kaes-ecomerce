import { prisma } from '../config/prisma.js'
import { logger } from '../config/logger.js'
import { captureError, captureMessage } from '../config/sentry.js'
import { sendTaxChangeAlert } from './email.service.js'
import { getTaxSetting } from './tax-settings.service.js'

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

const log = logger.child({ component: 'tax-check' })

const DEFAULT_SOURCE = 'https://www.secretariasenado.gov.co/senado/basedoc/estatuto_tributario_pr014.html'
const MIN_INTERVAL_MS = 23 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 15000

const decodeBody = async (res) => {
  // La página puede venir en ISO-8859-1; si el fetch entrega ArrayBuffer lo decodificamos.
  if (typeof res.arrayBuffer === 'function') return new TextDecoder('iso-8859-1').decode(await res.arrayBuffer())
  return res.text()
}

/**
 * Compara la tasa guardada con la de la fuente oficial. NUNCA cambia precios ni la tasa:
 * si difiere, deja `pendingRate` y avisa (Sentry + correo, una sola vez por valor).
 * No lanza excepciones: el job de mantenimiento no debe caerse por esto.
 */
export const checkTaxRate = async ({ fetchFn = fetch, db = prisma, now = new Date(), force = false } = {}) => {
  const source = process.env.TAX_SOURCE_URL || DEFAULT_SOURCE
  try {
    const current = await getTaxSetting(db)
    if (!force && current.lastCheckAt && now - new Date(current.lastCheckAt) < MIN_INTERVAL_MS) {
      return { status: 'skipped' }
    }

    const touch = (extra = {}) => db.taxSetting.upsert({
      where: { id: 1 },
      update: { lastCheckAt: now, lastCheckSource: source, ...extra },
      create: { id: 1, lastCheckAt: now, lastCheckSource: source, ...extra },
    })

    let detected = null
    try {
      const res = await fetchFn(source, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      detected = parseGeneralRate(await decodeBody(res))
    } catch (err) {
      log.error({ err, source }, 'tax.check_failed')
      captureError(err, { job: 'tax-check', source })
      await touch()
      return { status: 'error' }
    }

    if (detected === null) {
      const err = new Error('No se pudo leer la tarifa de IVA en la fuente oficial')
      log.error({ source }, 'tax.check_unparseable')
      captureError(err, { job: 'tax-check', source })
      await touch()
      return { status: 'error' }
    }

    if (detected === current.rate) {
      await touch({ lastCheckRate: detected, pendingRate: null })
      return { status: 'unchanged', detected }
    }

    await touch({ lastCheckRate: detected, pendingRate: detected })
    if (current.pendingRate !== detected) {
      log.warn({ currentRate: current.rate, detected, source }, 'tax.rate_change_detected')
      captureMessage('La fuente oficial indica otra tarifa de IVA', { currentRate: current.rate, detected, source })
      await sendTaxChangeAlert({ currentRate: current.rate, detectedRate: detected, source })
    }
    return { status: 'pending', detected }
  } catch (err) {
    log.error({ err }, 'tax.check_crashed')
    captureError(err, { job: 'tax-check' })
    return { status: 'error' }
  }
}
