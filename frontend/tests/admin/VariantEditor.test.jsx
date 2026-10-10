import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import VariantEditor, { buildCombos, variantKey } from '../../src/components/admin/VariantEditor.jsx'

afterEach(cleanup)

const negro = { name: 'Negro', hex: '#000000' }
const blanco = { name: 'Blanco', hex: '#FFFFFF' }
const S = { id: 's1', value: 'S' }
const M = { id: 's2', value: 'M' }

describe('buildCombos', () => {
  it('colores × tallas', () => {
    expect(buildCombos([negro, blanco], [S, M])).toHaveLength(4)
  })
  it('sólo colores → talla null', () => {
    expect(buildCombos([negro], [])).toEqual([{ size: null, color: 'Negro', colorHex: '#000000' }])
  })
  it('sólo tallas → color null', () => {
    expect(buildCombos([], [S])).toEqual([{ size: 'S', color: null, colorHex: null }])
  })
  it('nada → sin combinaciones', () => {
    expect(buildCombos([], [])).toEqual([])
  })
})

describe('VariantEditor', () => {
  it('muestra un aviso si no hay colores ni tallas', () => {
    render(<VariantEditor colors={[]} sizes={[]} cells={{}} onChange={() => {}} />)
    expect(screen.getByText(/al menos un color o una talla/)).toBeTruthy()
  })

  it('edita el stock de una celda de la matriz', () => {
    const onChange = vi.fn()
    render(<VariantEditor colors={[negro]} sizes={[S, M]} cells={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Stock Negro talla M'), { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith({ [variantKey('M', 'Negro')]: { stock: 7, sku: '', basePrice: '' } })
  })

  it('no acepta stock negativo', () => {
    const onChange = vi.fn()
    render(<VariantEditor colors={[negro]} sizes={[S]} cells={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Stock Negro talla S'), { target: { value: '-3' } })
    expect(onChange.mock.calls[0][0][variantKey('S', 'Negro')].stock).toBe(0)
  })

  it('"Aplicar" pone el mismo stock en todas las variantes y muestra el total', () => {
    const onChange = vi.fn()
    const { rerender } = render(<VariantEditor colors={[negro, blanco]} sizes={[S, M]} cells={{}} onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('ej. 10'), { target: { value: '5' } })
    fireEvent.click(screen.getByText('Aplicar'))
    const next = onChange.mock.calls.at(-1)[0]
    expect(Object.values(next).map((c) => c.stock)).toEqual([5, 5, 5, 5])
    rerender(<VariantEditor colors={[negro, blanco]} sizes={[S, M]} cells={next} onChange={onChange} />)
    expect(screen.getByText('20')).toBeTruthy()
  })

  it('modo sólo tallas renderiza una fila por talla', () => {
    render(<VariantEditor colors={[]} sizes={[S, M]} cells={{}} onChange={() => {}} />)
    expect(screen.getByLabelText('Stock S')).toBeTruthy()
    expect(screen.getByLabelText('Stock M')).toBeTruthy()
  })
})
