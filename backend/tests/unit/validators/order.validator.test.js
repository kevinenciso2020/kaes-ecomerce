import { describe, it, expect } from 'vitest'
import { validationResult } from 'express-validator'
import { createOrder } from '../../../src/validators/order.validator.js'

const run = async (body) => {
  const req = { body }
  for (const v of createOrder) await v.run(req)
  return validationResult(req).array().map((e) => ({ field: e.path, message: e.msg }))
}

const base = {
  items: [{ productId: 'p1', quantity: 1 }],
  acceptTerms: true,
  address: { street: 'Calle 1', departamento: 'Antioquia', municipio: 'Medellín', fullName: 'Ana', phone: '3001234567' },
}

describe('createOrder — datos de facturación (buyer)', () => {
  it('sin buyer es válido (consumidor final)', async () => {
    expect(await run(base)).toEqual([])
    expect(await run({ ...base, buyer: null })).toEqual([])
  })

  it('acepta cédula de ciudadanía', async () => {
    expect(await run({ ...base, buyer: { docType: '13', docNumber: '1020304050', name: 'Ana Pérez' } })).toEqual([])
  })

  it('acepta NIT con DV correcto y sin DV', async () => {
    expect(await run({ ...base, buyer: { docType: '31', docNumber: '800197268', dv: '4', name: 'DIAN' } })).toEqual([])
    expect(await run({ ...base, buyer: { docType: '31', docNumber: '800197268', name: 'DIAN' } })).toEqual([])
  })

  it('rechaza un DV que no corresponde al NIT', async () => {
    const errs = await run({ ...base, buyer: { docType: '31', docNumber: '800197268', dv: '7', name: 'DIAN' } })
    expect(errs).toEqual([{ field: 'buyer.dv', message: 'El dígito de verificación no corresponde al NIT' }])
  })

  it('acepta pasaporte alfanumérico', async () => {
    expect(await run({ ...base, buyer: { docType: '41', docNumber: 'AB123456', name: 'John Doe' } })).toEqual([])
  })

  it('rechaza tipo de documento desconocido, número con puntos o ceros a la izquierda, y nombre vacío', async () => {
    const fields = (await run({ ...base, buyer: { docType: '99', docNumber: '1.020.304', name: '' } })).map((e) => e.field)
    expect(fields).toEqual(expect.arrayContaining(['buyer.docType', 'buyer.docNumber', 'buyer.name']))
    const leadingZero = await run({ ...base, buyer: { docType: '13', docNumber: '0102030', name: 'Ana Pérez' } })
    expect(leadingZero.map((e) => e.field)).toEqual(['buyer.docNumber'])
  })
})
