import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('../../src/lib/api.js', () => ({
  api: { admin: { tax: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn() } },
}))

import { api } from '../../src/lib/api.js'
import ProductFormModal from '../../src/components/admin/ProductFormModal.jsx'

const categories = [{ id: 'c1', name: 'Camisas' }]

const setup = async () => {
  api.admin.tax.mockResolvedValue({ rate: 19 })
  api.admin.createProduct.mockResolvedValue({ id: 'p1' })
  const utils = render(<ProductFormModal categories={categories} colors={[]} sizes={[]} onClose={() => {}} onSaved={() => {}} />)
  await waitFor(() => expect(api.admin.tax).toHaveBeenCalled())
  return utils
}

describe('ProductFormModal: precio sin IVA', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra IVA y precio final, y el exento los quita', async () => {
    const { container } = await setup()
    fireEvent.change(screen.getByPlaceholderText('50000'), { target: { value: '20000' } })
    const small = container.querySelector('.pf-field small')
    expect(small.textContent).toContain('$3.800')
    expect(small.textContent).toContain('$23.800')
    fireEvent.click(screen.getByLabelText('Producto exento de IVA'))
    expect(container.querySelector('.pf-field small').textContent).toContain('Precio final: $20.000')
  })

  it('envía basePrice y taxRate, sin price', async () => {
    const { container } = await setup()
    fireEvent.change(screen.getByPlaceholderText('50000'), { target: { value: '20000' } })
    fireEvent.change(screen.getByPlaceholderText(/Camiseta/), { target: { value: 'Camisa lino' } })
    fireEvent.change(container.querySelector('select'), { target: { value: 'c1' } })
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(api.admin.createProduct).toHaveBeenCalledTimes(1))
    const form = api.admin.createProduct.mock.calls[0][0]
    expect(form.get('basePrice')).toBe('20000')
    expect(form.get('taxRate')).toBe('19')
    expect(form.has('price')).toBe(false)

    fireEvent.click(screen.getByLabelText('Producto exento de IVA'))
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(api.admin.createProduct).toHaveBeenCalledTimes(2))
    expect(api.admin.createProduct.mock.calls[1][0].get('taxRate')).toBe('0')
  })
})
