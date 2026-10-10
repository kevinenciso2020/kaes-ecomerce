import { describe, it, expect, afterEach } from 'vitest'
import { getConfig } from '../../../src/services/einvoice/config.js'
import { TEST_ENV, withEnv } from '../../helpers/einvoice.js'

let restore
afterEach(() => restore?.())

describe('getConfig — NIT del emisor', () => {
  it('acepta el NIT con DV y lo separa', () => {
    restore = withEnv({ ...TEST_ENV, EINVOICE_ISSUER_NIT: '900.373.115-3' })
    expect(getConfig().issuer).toMatchObject({ nit: '900373115', dv: '3' })
  })

  it('rechaza un DV que no corresponde en vez de pegarlo al NIT', () => {
    restore = withEnv({ ...TEST_ENV, EINVOICE_ISSUER_NIT: '900373115-7' })
    expect(() => getConfig()).toThrow(/DV del NIT del emisor no corresponde/)
  })

  it('rechaza caracteres no válidos', () => {
    restore = withEnv({ ...TEST_ENV, EINVOICE_ISSUER_NIT: 'NIT 900373115' })
    expect(() => getConfig()).toThrow(/EINVOICE_ISSUER_NIT/)
  })

  it('informa todo lo que falta sin lanzar al importar', () => {
    restore = withEnv({ EINVOICE_ISSUER_NIT: undefined, EINVOICE_SOFTWARE_ID: undefined, EINVOICE_CERT_PEM_BASE64: undefined, EINVOICE_KEY_PEM_BASE64: undefined })
    const err = (() => { try { getConfig() } catch (e) { return e } })()
    expect(err.code).toBe('EINVOICE_CONFIG')
    expect(err.missing).toEqual(expect.arrayContaining(['EINVOICE_ISSUER_NIT', 'EINVOICE_SOFTWARE_ID']))
  })
})
