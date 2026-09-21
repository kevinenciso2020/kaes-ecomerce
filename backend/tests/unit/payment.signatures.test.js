import crypto from 'node:crypto'
import { describe, it, expect, beforeEach } from 'vitest'

import {
  verifyEventChecksum,
  integritySignature,
  buildCheckoutUrl,
  buildReference,
  orderIdFromReference,
} from '../../src/config/wompi.js'
import { verifyMpSignature } from '../../src/config/mercadopago.js'
import { mapWompiStatus, mapMercadoPagoStatus, PAY } from '../../src/services/payment.service.js'

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

beforeEach(() => {
  process.env.WOMPI_EVENTS_SECRET = 'prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z'
  process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity_secret'
  process.env.WOMPI_PUBLIC_KEY = 'pub_test_abc'
  process.env.MP_WEBHOOK_SECRET = 'mp_secret'
})

// Evento con la estructura de la documentación de Wompi
// (https://docs.wompi.co/docs/colombia/eventos/).
const wompiEvent = (overrides = {}) => {
  const event = {
    event: 'transaction.updated',
    data: {
      transaction: {
        id: '1234-1610641025-49201',
        status: 'APPROVED',
        amount_in_cents: 4490000,
        reference: 'KAES-cabc123-kz1',
        currency: 'COP',
      },
    },
    environment: 'prod',
    signature: {
      properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
      checksum: '',
    },
    timestamp: 1530291411,
    sent_at: '2018-07-20T16:45:05.000Z',
    ...overrides,
  }
  // Mismo string que el ejemplo de la documentación:
  // 1234-1610641025-49201APPROVED44900001530291411prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z
  event.signature.checksum = sha256(
    '1234-1610641025-49201APPROVED44900001530291411prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z',
  ).toUpperCase()
  return event
}

describe('Wompi — checksum de eventos', () => {
  it('acepta un evento correctamente firmado (checksum en mayúsculas como lo envía Wompi)', () => {
    expect(verifyEventChecksum(wompiEvent())).toEqual({ valid: true })
  })

  it('acepta el checksum del header X-Event-Checksum si no viene en el body', () => {
    const e = wompiEvent()
    const header = e.signature.checksum
    e.signature.checksum = undefined
    expect(verifyEventChecksum(e, header)).toEqual({ valid: true })
  })

  it('rechaza si alguien altera el monto o el estado', () => {
    const tampered = wompiEvent()
    tampered.data.transaction.amount_in_cents = 100
    expect(verifyEventChecksum(tampered).valid).toBe(false)

    const tampered2 = wompiEvent()
    tampered2.data.transaction.status = 'DECLINED'
    expect(verifyEventChecksum(tampered2).valid).toBe(false)
  })

  it('rechaza con otro secreto o sin firma', () => {
    process.env.WOMPI_EVENTS_SECRET = 'otro'
    expect(verifyEventChecksum(wompiEvent()).valid).toBe(false)
    expect(verifyEventChecksum({ ...wompiEvent(), signature: undefined }).reason).toBe('signature_missing')
  })

  it('usa WOMPI_WEBHOOK_SECRET como respaldo del nombre antiguo', () => {
    delete process.env.WOMPI_EVENTS_SECRET
    process.env.WOMPI_WEBHOOK_SECRET = 'prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z'
    expect(verifyEventChecksum(wompiEvent()).valid).toBe(true)
    delete process.env.WOMPI_WEBHOOK_SECRET
  })
})

describe('Wompi — Web Checkout', () => {
  it('firma de integridad = SHA256(referencia + monto + moneda + [expiración] + secreto)', () => {
    expect(integritySignature({ reference: 'R1', amountInCents: 5990000, currency: 'COP' }))
      .toBe(sha256('R15990000COPtest_integrity_secret'))
    expect(integritySignature({ reference: 'R1', amountInCents: 5990000, currency: 'COP', expirationTime: '2026-09-21T20:00:00.000Z' }))
      .toBe(sha256('R15990000COP2026-09-21T20:00:00.000Ztest_integrity_secret'))
  })

  it('arma la URL de checkout.wompi.co con todos los parámetros', () => {
    const url = new URL(buildCheckoutUrl({
      reference: 'KAES-o1-x', amountInCents: 5990000, redirectUrl: 'https://kaes.co/checkout/resultado?orderId=o1',
      customerEmail: 'a@b.co', customerPhone: '300 123 4567',
    }))
    expect(url.origin + url.pathname).toBe('https://checkout.wompi.co/p/')
    expect(url.searchParams.get('public-key')).toBe('pub_test_abc')
    expect(url.searchParams.get('amount-in-cents')).toBe('5990000')
    expect(url.searchParams.get('currency')).toBe('COP')
    expect(url.searchParams.get('signature:integrity')).toBe(sha256('KAES-o1-x5990000COPtest_integrity_secret'))
    expect(url.searchParams.get('customer-data:phone-number')).toBe('3001234567')
  })

  it('referencias únicas por intento y reversibles al orderId', () => {
    const r1 = buildReference('cmabc123')
    expect(r1).toMatch(/^KAES-cmabc123-[a-z0-9]+$/)
    expect(orderIdFromReference(r1)).toBe('cmabc123')
    expect(orderIdFromReference('ORDER-cmold1')).toBe('cmold1')
    expect(orderIdFromReference('otra-cosa')).toBeNull()
  })
})

describe('MercadoPago — x-signature', () => {
  const sign = (manifest) => crypto.createHmac('sha256', 'mp_secret').update(manifest).digest('hex')

  it('valida con data.id del query (en minúsculas), x-request-id y ts', () => {
    const v1 = sign('id:abc123;request-id:req-1;ts:1704908010;')
    expect(verifyMpSignature({ xSignature: `ts=1704908010,v1=${v1}`, xRequestId: 'req-1', dataId: 'ABC123' }))
      .toEqual({ valid: true })
  })

  it('omite del manifest las partes que no llegan', () => {
    const v1 = sign('id:999;ts:1704908010;')
    expect(verifyMpSignature({ xSignature: `ts=1704908010,v1=${v1}`, dataId: '999' }).valid).toBe(true)
  })

  it('rechaza firmas alteradas o mal formadas', () => {
    const v1 = sign('id:999;request-id:r;ts:1;')
    expect(verifyMpSignature({ xSignature: `ts=1,v1=${v1}`, xRequestId: 'r', dataId: '1000' }).valid).toBe(false)
    expect(verifyMpSignature({ xSignature: 'ts=1', xRequestId: 'r', dataId: '999' }).reason).toBe('signature_malformed')
    expect(verifyMpSignature({ xSignature: undefined }).reason).toBe('signature_missing')
  })
})

describe('Mapeo de estados', () => {
  it('Wompi', () => {
    expect(mapWompiStatus('APPROVED')).toBe(PAY.APPROVED)
    expect(mapWompiStatus('DECLINED')).toBe(PAY.DECLINED)
    expect(mapWompiStatus('VOIDED')).toBe(PAY.VOIDED)
    expect(mapWompiStatus('ERROR')).toBe(PAY.ERROR)
    expect(mapWompiStatus('PENDING')).toBe(PAY.PENDING)
  })

  it('MercadoPago', () => {
    expect(mapMercadoPagoStatus('approved')).toBe(PAY.APPROVED)
    expect(mapMercadoPagoStatus('rejected')).toBe(PAY.DECLINED)
    expect(mapMercadoPagoStatus('in_process')).toBe(PAY.PENDING)
    expect(mapMercadoPagoStatus('refunded')).toBe(PAY.VOIDED)
    expect(mapMercadoPagoStatus('charged_back')).toBe(PAY.VOIDED)
  })
})
