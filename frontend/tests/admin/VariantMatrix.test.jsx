import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React, { useState } from 'react'
import VariantMatrix from '../../src/components/admin/VariantMatrix.jsx'

const COLORS = [
  { id: 'c1', name: 'Negro',  hex: '#000000' },
  { id: 'c2', name: 'Blanco', hex: '#FFFFFF' },
]

const SIZES = [
  { id: 's1', value: 'S', scale: 'LETTER' },
  { id: 's2', value: 'M', scale: 'LETTER' },
  { id: 's3', value: 'L', scale: 'LETTER' },
]

function Harness({ initialValue = { variants: [] }, onChangeSpy }) {
  const [value, setValue] = useState(initialValue)
  const handleChange = (next) => {
    setValue(next)
    onChangeSpy?.(next)
  }
  return <VariantMatrix colors={COLORS} sizes={SIZES} value={value} onChange={handleChange} defaultLowStockThreshold={5} />
}

describe('VariantMatrix', () => {
  it('shows a placeholder when no colors or sizes provided', () => {
    render(<VariantMatrix colors={[]} sizes={[]} value={{ variants: [] }} onChange={() => {}} />)
    expect(screen.getByText(/Selecciona al menos un color y una talla/)).toBeTruthy()
  })

  it('renders a row per color and a column per size', () => {
    render(<Harness />)
    // Header row: "Color ↓ / Talla →" + 3 sizes (S, M, L)
    expect(screen.getByText('S')).toBeTruthy()
    expect(screen.getByText('M')).toBeTruthy()
    expect(screen.getByText('L')).toBeTruthy()
    // Body rows for each color
    expect(screen.getByText('Negro')).toBeTruthy()
    expect(screen.getByText('Blanco')).toBeTruthy()
  })

  it('seeds empty cells when colors/sizes arrive after mount', () => {
    const onChange = vi.fn()
    render(<Harness onChangeSpy={onChange} />)
    // El useEffect interno debe agregar N×M entradas vacías al array de variants
    expect(onChange).toHaveBeenCalled()
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(lastCall.variants.length).toBe(COLORS.length * SIZES.length)
  })

  it('updates the stock of a cell when the user types', () => {
    const onChange = vi.fn()
    render(<Harness onChangeSpy={onChange} />)

    // Encontrar la celda M/Blanco y cambiar su stock
    const inputs = screen.getAllByPlaceholderText('0')
    // Primer input = Negro/S
    const firstInput = inputs[0]
    fireEvent.change(firstInput, { target: { value: '5' } })

    // onChange fue llamado y el primer variant tiene stock=5
    const calls = onChange.mock.calls
    const lastCall = calls[calls.length - 1][0]
    const v = lastCall.variants.find((x) => x.color === 'Negro' && x.size === 'S')
    expect(v).toBeTruthy()
    expect(v.stock).toBe(5)
  })

  it('preserves existing variant data when re-rendering', () => {
    const initial = {
      variants: [
        { size: 'M', color: 'Negro', colorHex: '#000', stock: 10, sku: 'ABC', lowStockThreshold: null, price: null },
      ],
    }
    render(<Harness initialValue={initial} />)
    // El input de la celda M/Negro debe mostrar 10
    const inputs = screen.getAllByPlaceholderText('0')
    const cellM = inputs.find((i) => i.value === '10')
    expect(cellM).toBeTruthy()
  })

  it('clamps negative stock to 0', () => {
    const onChange = vi.fn()
    render(<Harness onChangeSpy={onChange} />)
    const inputs = screen.getAllByPlaceholderText('0')
    fireEvent.change(inputs[0], { target: { value: '-5' } })
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    const v = lastCall.variants.find((x) => x.color === 'Negro' && x.size === 'S')
    expect(v.stock).toBe(0)
  })
})
