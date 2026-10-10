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
    expect(confirm.mock.calls[0][0]).toMatch(/contador/i)
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
    api.admin.setTaxRate.mockRejectedValue(Object.assign(new Error('Hay productos con esa tasa propia'), { name: 'ApiError', status: 409, code: 'CONFLICT' }))
    render(<TaxSettings />)
    const input = await screen.findByDisplayValue('19')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar tasa/i }))
    expect(await screen.findByText(/productos con esa tasa propia/i)).toBeTruthy()
    expect(screen.getByDisplayValue('5')).toBeTruthy()
  })

  const ready = async (tax = { rate: 19, pendingRate: null }) => {
    bootstrapAuth.mockResolvedValue(superAdmin)
    api.admin.tax.mockResolvedValue(tax)
    render(<TaxSettings />)
    return screen.findByLabelText(/tasa vigente/i)
  }

  it.each([['vacío', ''], ['espacios', '  '], ['negativa', '-1'], ['mayor a 30', '45']])('rechaza tasa %s sin confirmar ni llamar a la API', async (_n, value) => {
    const input = await ready()
    fireEvent.change(input, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: /guardar tasa/i }))
    expect(await screen.findByText(/escribe una tasa entre 0 y 30/i)).toBeTruthy()
    expect(api.admin.setTaxRate).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('si se cancela la confirmación no cambia la tasa', async () => {
    const input = await ready({ rate: 19, pendingRate: 21 })
    confirm.mockReturnValue(false)
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar tasa/i }))
    fireEvent.click(screen.getByRole('button', { name: /aplicar 21 %/i }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(api.admin.setTaxRate).not.toHaveBeenCalled()
    expect(api.admin.applyPendingTax).not.toHaveBeenCalled()
  })

  it('si la recarga falla tras guardar, no lo reporta como fallo del cambio', async () => {
    bootstrapAuth.mockResolvedValue(superAdmin)
    api.admin.tax.mockResolvedValueOnce({ rate: 19, pendingRate: null }).mockRejectedValueOnce(new Error('red caída'))
    api.admin.setTaxRate.mockResolvedValue({ rate: 5, changed: true, productsUpdated: 2 })
    render(<TaxSettings />)
    const input = await screen.findByDisplayValue('19')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar tasa/i }))
    expect(await screen.findByText(/el cambio se guardó, pero no se pudo recargar/i)).toBeTruthy()
    expect(screen.queryByText(/red caída/)).toBeNull()
  })

  it.each([
    [{ status: 'unchanged' }, /coincide con tu tasa/i],
    [{ status: 'pending', detected: 21 }, /indica 21 %\. No se cambió ningún precio/i],
    [{ status: 'pending', detected: 0 }, /indica 0 %\. No se cambió ningún precio/i],
    [{ status: 'error' }, /no se pudo leer la fuente/i],
    [{ status: 'skipped' }, /revisada hace poco/i],
  ])('revisar ahora con %j', async (result, text) => {
    await ready()
    api.admin.checkTax.mockResolvedValue(result)
    fireEvent.click(screen.getByRole('button', { name: /revisar ahora/i }))
    expect(await screen.findByText(text)).toBeTruthy()
  })
})
