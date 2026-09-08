import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ColorSwatch from '../../src/components/admin/ColorSwatch.jsx'

describe('ColorSwatch', () => {
  it('renders the color name', () => {
    render(<ColorSwatch hex="#ff0000" name="Rojo" />)
    expect(screen.getByText('Rojo')).toBeTruthy()
  })

  it('uses the hex as background', () => {
    const { container } = render(<ColorSwatch hex="#000000" name="Negro" />)
    const dot = container.querySelector('span[aria-hidden="true"]')
    expect(dot.style.backgroundColor).toBe('rgb(0, 0, 0)')
  })

  it('hides the name when showName=false', () => {
    render(<ColorSwatch hex="#fff" name="Blanco" showName={false} />)
    expect(screen.queryByText('Blanco')).toBeNull()
  })

  it('adds a darker border for white to keep the dot visible', () => {
    const { container } = render(<ColorSwatch hex="#FFFFFF" name="Blanco" />)
    const dot = container.querySelector('span[aria-hidden="true"]')
    expect(dot.style.border).toContain('1px solid')
    expect(dot.style.border).toContain('rgb(221, 221, 221)')
  })

  it('uses hex color as border for non-white colors', () => {
    const { container } = render(<ColorSwatch hex="#dc2626" name="Rojo" />)
    const dot = container.querySelector('span[aria-hidden="true"]')
    expect(dot.style.border).toContain('rgb(220, 38, 38)')
  })

  it('falls back to gray when hex is undefined', () => {
    const { container } = render(<ColorSwatch name="Sin hex" />)
    const dot = container.querySelector('span[aria-hidden="true"]')
    expect(dot.style.backgroundColor).toBe('rgb(204, 204, 204)')
  })

  it('respects the size prop', () => {
    const { container } = render(<ColorSwatch hex="#000" name="X" size={20} />)
    const dot = container.querySelector('span[aria-hidden="true"]')
    expect(dot.style.width).toBe('20px')
    expect(dot.style.height).toBe('20px')
  })
})
