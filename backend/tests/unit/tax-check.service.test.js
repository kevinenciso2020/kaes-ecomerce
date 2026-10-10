import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/sentry.js', () => ({ captureError: vi.fn(), captureMessage: vi.fn() }))
vi.mock('../../src/services/email.service.js', () => ({ sendTaxChangeAlert: vi.fn().mockResolvedValue(true) }))

const { parseGeneralRate, checkTaxRate } = await import('../../src/services/tax-check.service.js')
const { captureError, captureMessage } = await import('../../src/config/sentry.js')
const { sendTaxChangeAlert } = await import('../../src/services/email.service.js')

const page = (art) => `<html><body><p>ARTICULO 467. otro texto 5%</p>${art}<p>ARTICULO 469. más texto 10%</p></body></html>`

describe('parseGeneralRate', () => {
  it('lee la tarifa del artículo 468', () => {
    const html = page('<p><b>ARTICULO 468. TARIFA GENERAL DEL IMPUESTO SOBRE LAS VENTAS.</b> La tarifa general del impuesto sobre las ventas es del diecinueve por ciento (19%).</p>')
    expect(parseGeneralRate(html)).toBe(19)
  })
  it('tolera tildes, mayúsculas, entidades y espacios', () => {
    const html = page('<p>Artículo&nbsp;468.  Tarifa   general del impuesto sobre las ventas.   La tarifa general del impuesto sobre las ventas es del veintiún por ciento (21 %).</p>')
    expect(parseGeneralRate(html)).toBe(21)
  })
  it('acepta decimal con coma', () => {
    const html = page('<p>ARTICULO 468. La tarifa general del impuesto sobre las ventas es del cinco punto cinco por ciento (5,5%).</p>')
    expect(parseGeneralRate(html)).toBe(5.5)
  })
  it('no toma porcentajes de otros artículos', () => {
    expect(parseGeneralRate(page('<p>ARTICULO 468. Texto sin porcentaje.</p>'))).toBeNull()
  })
  it('null si no existe el artículo 468', () => {
    expect(parseGeneralRate('<html>página de error</html>')).toBeNull()
    expect(parseGeneralRate('')).toBeNull()
    expect(parseGeneralRate(undefined)).toBeNull()
  })
  it('null si el valor es absurdo (fuera de 0–30)', () => {
    const html = page('<p>ARTICULO 468. La tarifa general del impuesto sobre las ventas es del ciento noventa por ciento (190%).</p>')
    expect(parseGeneralRate(html)).toBeNull()
  })
  it('acepta "Artículo 468." en mayúsculas con tilde', () => {
    const html = page('<p>ARTÍCULO 468. TARIFA GENERAL DEL IMPUESTO SOBRE LAS VENTAS. La tarifa general del impuesto sobre las ventas es del diecinueve por ciento (19%).</p>')
    expect(parseGeneralRate(html)).toBe(19)
  })
  it('no se rompe si el encabezado repite el título del artículo', () => {
    const html = page('<h2>TARIFA GENERAL DEL IMPUESTO SOBRE LAS VENTAS</h2><h3>TARIFA GENERAL DEL IMPUESTO SOBRE LAS VENTAS</h3><p><b>ARTÍCULO 468.</b> <b>TARIFA GENERAL DEL IMPUESTO SOBRE LAS VENTAS.</b> La tarifa general del impuesto sobre las ventas es del diecinueve por ciento (19%).</p>')
    expect(parseGeneralRate(html)).toBe(19)
  })
  it('ignora porcentajes de notas de modificación dentro del artículo', () => {
    const html = page('<p>ARTICULO 468. <i>Artículo modificado por el artículo 184 de la Ley 1607 de 2012</i> (16%). <i>Modificado por la Ley 2010 de 2019 (19%)</i>. La tarifa general del impuesto sobre las ventas es del diecinueve por ciento (19%).</p>')
    expect(parseGeneralRate(html)).toBe(19)
    const html2 = page('<p>ARTICULO 468. Ley 2010 de 2019 (19%). <i>Artículo modificado por el artículo 184 de la Ley 1607 de 2012</i> La tarifa general del impuesto sobre las ventas es del veintiún por ciento (21%).</p>')
    expect(parseGeneralRate(html2)).toBe(21)
  })
  it('null si sólo hay porcentajes de notas y no la frase de la tarifa general', () => {
    const html = page('<p>ARTICULO 468. Modificado por la Ley 2010 de 2019 (19%).</p>')
    expect(parseGeneralRate(html)).toBeNull()
  })
})

const html = (pct, word = 'diecinueve') =>
  `<p>ARTICULO 468. La tarifa general del impuesto sobre las ventas es del ${word} por ciento (${pct}%).</p>`
const okFetch = (body) => vi.fn().mockResolvedValue({ ok: true, text: async () => body })

const makeDb = (row) => ({
  taxSetting: {
    findUnique: vi.fn().mockResolvedValue(row),
    upsert: vi.fn().mockResolvedValue({}),
  },
})
const base = { id: 1, rate: 19, pendingRate: null, lastCheckAt: null }

describe('checkTaxRate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('misma tasa: sin alerta y sin pendiente', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: okFetch(html(19)), db })
    expect(r.status).toBe('unchanged')
    expect(sendTaxChangeAlert).not.toHaveBeenCalled()
    expect(db.taxSetting.upsert.mock.calls[0][0].update).toMatchObject({ pendingRate: null, lastCheckRate: 19 })
  })

  it('tasa distinta: guarda pendingRate, avisa a Sentry y por correo, NO cambia rate', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: okFetch(html(21, 'veintiuno')), db })
    expect(r).toEqual({ status: 'pending', detected: 21 })
    const update = db.taxSetting.upsert.mock.calls[0][0].update
    expect(update.pendingRate).toBe(21)
    expect(update).not.toHaveProperty('rate')
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(sendTaxChangeAlert).toHaveBeenCalledWith(expect.objectContaining({ currentRate: 19, detectedRate: 21 }))
  })

  it('la fuente indica 0 %: es una lectura válida (pending, detected 0)', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: okFetch(html(0, 'cero')), db })
    expect(r).toEqual({ status: 'pending', detected: 0 })
    expect(db.taxSetting.upsert.mock.calls[0][0].update.pendingRate).toBe(0)
  })

  it('no repite la alerta si el mismo pendingRate ya estaba guardado', async () => {
    const db = makeDb({ ...base, pendingRate: 21 })
    await checkTaxRate({ fetchFn: okFetch(html(21, 'veintiuno')), db, force: true })
    expect(sendTaxChangeAlert).not.toHaveBeenCalled()
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('se salta si ya se revisó hace menos de 23 h (sin force)', async () => {
    const now = new Date('2026-10-09T12:00:00Z')
    const db = makeDb({ ...base, lastCheckAt: new Date('2026-10-09T05:00:00Z') })
    const fetchFn = okFetch(html(19))
    const r = await checkTaxRate({ fetchFn, db, now })
    expect(r.status).toBe('skipped')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('force ignora el intervalo', async () => {
    const now = new Date('2026-10-09T12:00:00Z')
    const db = makeDb({ ...base, lastCheckAt: new Date('2026-10-09T11:00:00Z') })
    const r = await checkTaxRate({ fetchFn: okFetch(html(19)), db, now, force: true })
    expect(r.status).toBe('unchanged')
  })

  it('fuente caída: no lanza, no cambia precios, registra el error', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')), db })
    expect(r.status).toBe('error')
    expect(captureError).toHaveBeenCalled()
    expect(db.taxSetting.upsert.mock.calls[0][0].update).not.toHaveProperty('pendingRate')
  })

  it('HTTP 500: error sin excepción', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: vi.fn().mockResolvedValue({ ok: false, status: 500 }), db })
    expect(r.status).toBe('error')
  })

  it('HTML irreconocible: error, sin pendingRate', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: okFetch('<html>cambió el sitio</html>'), db })
    expect(r.status).toBe('error')
    expect(db.taxSetting.upsert.mock.calls[0][0].update).not.toHaveProperty('pendingRate')
  })

  it('valor absurdo (190 %): error, sin pendingRate', async () => {
    const db = makeDb(base)
    const r = await checkTaxRate({ fetchFn: okFetch(html(190, 'ciento noventa')), db })
    expect(r.status).toBe('error')
  })
})
