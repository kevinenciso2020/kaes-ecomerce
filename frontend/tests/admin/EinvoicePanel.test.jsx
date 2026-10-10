import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('../../src/lib/api.js', () => ({
  api: {
    admin: {
      einvoice: vi.fn(),
      retryEinvoice: vi.fn(),
      downloadEinvoicePdf: vi.fn(),
      downloadEinvoiceXml: vi.fn(),
    },
  },
}))

const { api } = await import('../../src/lib/api.js')
const { default: EinvoicePanel, buyerLabel } = await import('../../src/components/admin/EinvoicePanel.jsx')

const order = { id: 'o1', status: 'CONFIRMED', paidAt: '2026-10-10T10:00:00Z' }

beforeEach(() => vi.clearAllMocks())

describe('buyerLabel', () => {
  it('muestra consumidor final o el documento con DV', () => {
    expect(buyerLabel({})).toBe('Consumidor final')
    expect(buyerLabel({ buyerDocType: '31', buyerDocNumber: '800197268', buyerDv: '4', buyerName: 'EMPRESA' })).toBe('EMPRESA · NIT 800197268-4')
  })
})

describe('EinvoicePanel', () => {
  it('avisa cuando la facturación está apagada', async () => {
    api.admin.einvoice.mockResolvedValue({ enabled: false, documents: [] })
    render(<EinvoicePanel order={order} />)
    expect(await screen.findByText(/está apagada/)).toBeTruthy()
  })

  it('muestra la factura validada con sus descargas', async () => {
    api.admin.einvoice.mockResolvedValue({
      enabled: true,
      documents: [{ id: 'd1', type: 'INVOICE', status: 'ACCEPTED', fullNumber: 'SETP990000001', cufe: 'abc', environment: '1', emailedAt: '2026-10-10T10:05:00Z' }],
    })
    render(<EinvoicePanel order={order} />)
    expect(await screen.findByText('Factura SETP990000001')).toBeTruthy()
    expect(screen.getByText('Validada DIAN')).toBeTruthy()
    fireEvent.click(screen.getByText('Descargar PDF'))
    await waitFor(() => expect(api.admin.downloadEinvoicePdf).toHaveBeenCalledWith('d1'))
    expect(screen.queryByText('Reintentar')).toBeNull()
  })

  it('permite reintentar una factura rechazada y muestra el error de la DIAN', async () => {
    const showToast = vi.fn()
    api.admin.einvoice.mockResolvedValue({
      enabled: true,
      documents: [{ id: 'd1', type: 'INVOICE', status: 'REJECTED', fullNumber: 'SETP990000001', cufe: 'abc', lastError: 'Regla: FAK24, Rechazo: DV incorrecto' }],
    })
    api.admin.retryEinvoice.mockResolvedValue({ enabled: true, documents: [{ id: 'd1', type: 'INVOICE', status: 'ACCEPTED', fullNumber: 'SETP990000001', cufe: 'abc' }] })
    render(<EinvoicePanel order={order} showToast={showToast} />)
    expect(await screen.findByText(/FAK24/)).toBeTruthy()
    fireEvent.click(screen.getByText('Reintentar'))
    expect(await screen.findByText('Validada DIAN')).toBeTruthy()
    expect(api.admin.retryEinvoice).toHaveBeenCalledWith('d1')
    expect(showToast).toHaveBeenCalledWith({ type: 'success', message: 'Documento reenviado a la DIAN' })
  })
})
