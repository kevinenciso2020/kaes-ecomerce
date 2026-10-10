import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('../../src/lib/api.js', () => ({
  api: { admin: { tax: vi.fn(), setTaxRate: vi.fn(), applyPendingTax: vi.fn(), checkTax: vi.fn() } },
  bootstrapAuth: vi.fn(),
}))

import { api, bootstrapAuth } from '../../src/lib/api.js'
import TaxSettings from '../../src/components/admin/TaxSettings.jsx'

afterEach(cleanup)
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('confirm', vi.fn(() => true)) })

const superAdmin = { role: 'SUPER_ADMIN' }

describe('TaxSettings', () => {
  it('bloquea a un ADMIN que no es SUPER_ADMIN', async () => {
    bootstrapAuth.mockResolvedValue({ role: 'ADMIN' })
    render(<TaxSettings />)
    expect(await screen.findByText(/solo el super administrador/i)).toBeTruthy()
    expect(api.admin.tax).not.toHaveBeenCalled()
  })

  it('muestra la tasa vigente', async () => {
    bootstrapAuth.mockResolvedValue(superAdmin)
    api.admin.tax.mockResolvedValue({ rate: 19, pendingRate: null, lastCheckAt: null })
    render(<TaxSettings />)
    expect(await screen.findByDisplayValue('19')).toBeTruthy()
  })

  it('con tasa pendiente muestra el banner y permite aplicarla', async () => {
    bootstrapAuth.mockResolvedValue(superAdmin)
    api.admin.tax
      .mockResolvedValueOnce({ rate: 19, pendingRate: 21, lastCheckAt: '2026-10-09T00:00:00Z' })
      .mockResolvedValueOnce({ rate: 21, pendingRate: null })
    api.admin.applyPendingTax.mockResolvedValue({ rate: 21, changed: true, productsUpdated: 4 })
    render(<TaxSettings />)
    expect(await screen.findByText(/indica 21 %/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /aplicar 21 %/i }))
    await waitFor(() => expect(api.admin.applyPendingTax).toHaveBeenCalled())
  })

  it('cambia la tasa manualmente tras confirmar', async () => {
    bootstrapAuth.mockResolvedValue(superAdmin)
    api.admin.tax.mockResolvedValue({ rate: 19, pendingRate: null })
    api.admin.setTaxRate.mockResolvedValue({ rate: 5, changed: true, productsUpdated: 2 })
    render(<TaxSettings />)
    const input = await screen.findByDisplayValue('19')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar tasa/i }))
    await waitFor(() => expect(api.admin.setTaxRate).toHaveBeenCalledWith(5))
  })

  it('un 409 al cambiar la tasa muestra el mensaje y conserva lo escrito', async () => {
    bootstrapAuth.mockResolvedValue(superAdmin)
    api.admin.tax.mockResolvedValue({ rate: 19, pendingRate: null })
    api.admin.setTaxRate.mockRejectedValue(Object.assign(new Error('Hay productos con esa tasa propia'), { status: 409 }))
    render(<TaxSettings />)
    const input = await screen.findByDisplayValue('19')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar tasa/i }))
    expect(await screen.findByText(/productos con esa tasa propia/i)).toBeTruthy()
    expect(screen.getByDisplayValue('5')).toBeTruthy()
  })
})
