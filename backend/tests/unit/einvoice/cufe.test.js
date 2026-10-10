import { describe, it, expect } from 'vitest'
import { computeCufe, computeCude, softwareSecurityCode, qrUrl } from '../../../src/services/einvoice/cufe.js'

describe('computeCufe', () => {
  it('reproduce el ejemplo oficial del Anexo Técnico (SHA-384)', () => {
    const cufe = computeCufe({
      number: '323200000129',
      issueDate: '2019-01-16',
      issueTime: '10:53:10-05:00',
      lineExtension: '1500000.00',
      taxIva: '285000.00',
      taxInc: '0.00',
      taxIca: '0.00',
      payable: '1785000.00',
      supplierNit: '700085371',
      customerId: '800199436',
      technicalKey: '693ff6f2a553c3646a063436fd4dd9ded0311471',
      environment: '1',
    })
    expect(cufe).toBe('8bb918b19ba22a694f1da11c643b5e9de39adf60311cf179179e9b33381030bcd4c3c3f156c506ed5908f9276f5bd9b4')
  })

  it('el CUDE usa el PIN del software en lugar de la clave técnica', () => {
    const base = {
      number: 'NC1', issueDate: '2026-10-10', issueTime: '10:00:00-05:00', lineExtension: '100.00',
      taxIva: '19.00', payable: '119.00', supplierNit: '900123456', customerId: '222222222222', environment: '2',
    }
    const cude = computeCude({ ...base, softwarePin: '12345' })
    expect(cude).toBe(computeCufe({ ...base, technicalKey: '12345' }))
    expect(cude).toHaveLength(96)
  })
})

describe('softwareSecurityCode', () => {
  it('es SHA-384 de SoftwareID + PIN + número', () => {
    expect(softwareSecurityCode('abc', '123', 'SETP990000001')).toMatch(/^[0-9a-f]{96}$/)
    expect(softwareSecurityCode('abc', '123', 'A1')).not.toBe(softwareSecurityCode('abc', '123', 'A2'))
  })
})

describe('qrUrl', () => {
  it('usa catalogo-vpfe en producción y catalogo-vpfe-hab en habilitación', () => {
    expect(qrUrl('1', 'X')).toBe('https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=X')
    expect(qrUrl('2', 'X')).toBe('https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=X')
  })
})
