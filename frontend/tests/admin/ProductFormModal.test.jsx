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
    await waitFor(() => expect(container.querySelector('.pf-field small').textContent).toContain('$3.800'))
    const small = container.querySelector('.pf-field small')
    expect(small.textContent).toContain('$23.800')
    fireEvent.click(screen.getByLabelText('Producto exento de IVA'))
    expect(container.querySelector('.pf-field small').textContent).toContain('Precio final: $20.000')
  })

  const enviar = async (valor) => {
    const { container } = await setup()
    fireEvent.change(screen.getByPlaceholderText('50000'), { target: { value: valor } })
    fireEvent.change(screen.getByPlaceholderText(/Camiseta/), { target: { value: 'Camisa lino' } })
    fireEvent.change(container.querySelector('select'), { target: { value: 'c1' } })
    fireEvent.submit(container.querySelector('form'))
    return container
  }

  it('acepta un precio de $50 (sin mínimo de negocio)', async () => {
    const container = await enviar('50')
    await waitFor(() => expect(api.admin.createProduct).toHaveBeenCalledTimes(1))
    expect(container.textContent).not.toContain('Precio mínimo')
  })

  it('el precio 0 muestra el error nuevo y no guarda', async () => {
    const container = await enviar('0')
    await waitFor(() => expect(container.textContent).toContain('Escribe un precio mayor que 0'))
    expect(api.admin.createProduct).not.toHaveBeenCalled()
  })

  it('rechaza precios sobre el tope técnico', async () => {
    const container = await enviar('70000001')
    await waitFor(() => expect(container.textContent).toContain('máximo $70.000.000'))
    expect(api.admin.createProduct).not.toHaveBeenCalled()
  })

  it('el input de precio no impone mínimo 100 ni paso de 100', async () => {
    await setup()
    const input = screen.getByPlaceholderText('50000')
    expect(input.getAttribute('min')).not.toBe('100')
    expect(input.getAttribute('step')).toBe('any')
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
    expect(form.has('taxRate')).toBe(false)
    expect(form.has('price')).toBe(false)

    fireEvent.click(screen.getByLabelText('Producto exento de IVA'))
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(api.admin.createProduct).toHaveBeenCalledTimes(2))
    expect(api.admin.createProduct.mock.calls[1][0].get('taxRate')).toBe('0')
  })
})

const editProduct = (over = {}) => ({
  id: 'p9', name: 'Camisa', basePrice: 20000, taxRate: 19, categoryId: 'c1', variants: [], images: [], ...over,
})

const saveEdit = async (product, rate = 21) => {
  api.admin.tax.mockResolvedValue({ rate })
  api.admin.updateProduct.mockResolvedValue({ id: product.id })
  const { container } = render(<ProductFormModal product={product} categories={categories} colors={[]} sizes={[]} onClose={() => {}} onSaved={() => {}} />)
  await waitFor(() => expect(api.admin.tax).toHaveBeenCalled())
  fireEvent.submit(container.querySelector('form'))
  await waitFor(() => expect(api.admin.updateProduct).toHaveBeenCalledTimes(1))
  return api.admin.updateProduct.mock.calls[0][1]
}

describe('ProductFormModal: tasa en edición y producto nuevo', () => {
  beforeEach(() => vi.clearAllMocks())

  it('existente con 19 y tasa general 21, sin tocar exento, NO envía taxRate', async () => {
    expect((await saveEdit(editProduct({ taxRate: 19 }), 21)).has('taxRate')).toBe(false)
  })
  it('existente exento sin tocar exento NO envía taxRate', async () => {
    expect((await saveEdit(editProduct({ taxRate: 0 }), 21)).has('taxRate')).toBe(false)
  })
  it('existente con 5 sin tocar exento NO envía taxRate', async () => {
    expect((await saveEdit(editProduct({ taxRate: 5 }), 21)).has('taxRate')).toBe(false)
  })
  it('existente no exento, al marcar exento envía 0', async () => {
    api.admin.tax.mockResolvedValue({ rate: 21 })
    api.admin.updateProduct.mockResolvedValue({ id: 'p9' })
    const { container } = render(<ProductFormModal product={editProduct({ taxRate: 19 })} categories={categories} colors={[]} sizes={[]} onClose={() => {}} onSaved={() => {}} />)
    await waitFor(() => expect(api.admin.tax).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('Producto exento de IVA'))
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(api.admin.updateProduct).toHaveBeenCalledTimes(1))
    expect(api.admin.updateProduct.mock.calls[0][1].get('taxRate')).toBe('0')
  })
  it('existente exento, al desmarcar envía la tasa general y la vista previa la usa', async () => {
    api.admin.tax.mockResolvedValue({ rate: 19 })
    api.admin.updateProduct.mockResolvedValue({ id: 'p9' })
    const { container } = render(<ProductFormModal product={editProduct({ taxRate: 0 })} categories={categories} colors={[]} sizes={[]} onClose={() => {}} onSaved={() => {}} />)
    await waitFor(() => expect(api.admin.tax).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText('Producto exento de IVA').checked).toBe(true))
    fireEvent.click(screen.getByLabelText('Producto exento de IVA'))
    await waitFor(() => expect(container.querySelector('.pf-field small').textContent).toContain('Precio final: $23.800'))
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(api.admin.updateProduct).toHaveBeenCalledTimes(1))
    expect(api.admin.updateProduct.mock.calls[0][1].get('taxRate')).toBe('19')
  })
  it('existente exento, al desmarcar sin tasa general: error y no llama a la API', async () => {
    api.admin.tax.mockRejectedValue(new Error('fallo'))
    const { container } = render(<ProductFormModal product={editProduct({ taxRate: 0 })} categories={categories} colors={[]} sizes={[]} onClose={() => {}} onSaved={() => {}} />)
    await waitFor(() => expect(api.admin.tax).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('Producto exento de IVA'))
    fireEvent.submit(container.querySelector('form'))
    expect(await screen.findByText('No se pudo leer la tasa de IVA vigente; recarga la página para quitar la exención.')).toBeTruthy()
    expect(api.admin.updateProduct).not.toHaveBeenCalled()
    expect(api.admin.createProduct).not.toHaveBeenCalled()
  })
  it('existente sin taxRate numérico no envía taxRate', async () => {
    const form = await saveEdit(editProduct({ taxRate: undefined }), 21)
    expect(form.has('taxRate')).toBe(false)
  })

  it('nuevo no exento con tasa cargada no envía taxRate', async () => {
    const { container } = await setup()
    fireEvent.change(screen.getByPlaceholderText('50000'), { target: { value: '20000' } })
    fireEvent.change(screen.getByPlaceholderText(/Camiseta/), { target: { value: 'Camisa lino' } })
    fireEvent.change(container.querySelector('select'), { target: { value: 'c1' } })
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(api.admin.createProduct).toHaveBeenCalledTimes(1))
    expect(api.admin.createProduct.mock.calls[0][0].has('taxRate')).toBe(false)
  })

  it('nuevo con api.admin.tax rechazando: sin taxRate, aviso y sin precio final', async () => {
    api.admin.tax.mockRejectedValue(new Error('fallo'))
    api.admin.createProduct.mockResolvedValue({ id: 'p1' })
    const { container } = render(<ProductFormModal categories={categories} colors={[]} sizes={[]} onClose={() => {}} onSaved={() => {}} />)
    expect(await screen.findByText('No se pudo leer la tasa de IVA; se usará la vigente al guardar.')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('50000'), { target: { value: '20000' } })
    expect(container.textContent).toContain('Calculando IVA…')
    expect(container.textContent).not.toContain('Precio final')
    fireEvent.change(screen.getByPlaceholderText(/Camiseta/), { target: { value: 'Camisa lino' } })
    fireEvent.change(container.querySelector('select'), { target: { value: 'c1' } })
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(api.admin.createProduct).toHaveBeenCalledTimes(1))
    expect(api.admin.createProduct.mock.calls[0][0].has('taxRate')).toBe(false)
  })

  it('la vista previa redondea la base a 2 decimales', async () => {
    const { container } = await setup()
    fireEvent.change(screen.getByPlaceholderText('50000'), { target: { value: '100.004' } })
    await waitFor(() => expect(container.querySelector('.pf-field small')).toBeTruthy())
    expect(container.querySelector('.pf-field small').textContent).toContain('Precio final: $119')
  })

  it('variantes: basePrice numérico o null, sin price', async () => {
    const colors = [{ id: 'k1', name: 'Rojo', hex: '#f00' }, { id: 'k2', name: 'Azul', hex: '#00f' }]
    const product = editProduct({
      variants: [
        { size: null, color: 'Rojo', colorHex: '#f00', stock: 1, sku: null, basePrice: 30000 },
        { size: null, color: 'Azul', colorHex: '#00f', stock: 1, sku: null, basePrice: null },
      ],
    })
    api.admin.tax.mockResolvedValue({ rate: 19 })
    api.admin.updateProduct.mockResolvedValue({ id: 'p9' })
    const { container } = render(<ProductFormModal product={product} categories={categories} colors={colors} sizes={[]} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(api.admin.updateProduct).toHaveBeenCalledTimes(1))
    const variants = JSON.parse(api.admin.updateProduct.mock.calls[0][1].get('variants'))
    const rojo = variants.find((v) => v.color === 'Rojo')
    const azul = variants.find((v) => v.color === 'Azul')
    expect(rojo.basePrice).toBe(30000)
    expect(azul.basePrice).toBeNull()
    expect(variants.every((v) => !('price' in v))).toBe(true)
  })
})
