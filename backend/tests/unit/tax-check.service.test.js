import { describe, it, expect } from 'vitest'
import { parseGeneralRate } from '../../src/services/tax-check.service.js'

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
