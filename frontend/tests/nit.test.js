import { describe, it, expect } from 'vitest'
import { computeNitDv, buildBuyer } from '../src/lib/nit.js'

describe('computeNitDv', () => {
  it('calcula el DV del NIT', () => {
    expect(computeNitDv('800197268')).toBe('4')
    expect(computeNitDv('890.903.938')).toBe('8')
    expect(computeNitDv('')).toBe('')
  })
})

describe('buildBuyer', () => {
  it('arma el comprador con cédula', () => {
    expect(buildBuyer({ docType: '13', docNumber: '1.020.304.050', name: ' Ana Pérez ' }))
      .toEqual({ buyer: { docType: '13', docNumber: '1020304050', name: 'Ana Pérez' } })
  })
  it('agrega el DV para NIT', () => {
    expect(buildBuyer({ docType: '31', docNumber: '800197268', name: 'EMPRESA SAS' }).buyer.dv).toBe('4')
  })
  it('rechaza números inválidos y nombres vacíos', () => {
    expect(buildBuyer({ docType: '13', docNumber: '0123', name: 'Ana' }).error).toMatch(/número de documento/)
    expect(buildBuyer({ docType: '31', docNumber: '800197268', name: '' }).error).toMatch(/razón social/)
    expect(buildBuyer({ docType: '', docNumber: '1', name: 'x' }).error).toMatch(/tipo de documento/)
  })
  it('separa el DV si el NIT se escribe con guion y lo valida', () => {
    expect(buildBuyer({ docType: '31', docNumber: '800.197.268-4', name: 'DIAN' }).buyer).toEqual({ docType: '31', docNumber: '800197268', dv: '4', name: 'DIAN' })
    expect(buildBuyer({ docType: '31', docNumber: '800197268-7', name: 'DIAN' }).error).toMatch(/dígito de verificación/)
  })
  it('no convierte un guion en parte del número para otros documentos', () => {
    expect(buildBuyer({ docType: '13', docNumber: '1020304-5', name: 'Ana Pérez' }).error).toMatch(/número de documento/)
  })
  it('acepta pasaporte alfanumérico', () => {
    expect(buildBuyer({ docType: '41', docNumber: 'AB123456', name: 'John Doe' }).buyer.docNumber).toBe('AB123456')
  })
})
