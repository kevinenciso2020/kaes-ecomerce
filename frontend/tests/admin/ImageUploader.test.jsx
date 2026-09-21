import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('../../src/lib/api.js', () => ({ api: { admin: { deleteProductImage: vi.fn(), setMainImage: vi.fn() } } }))

import ImageUploader, { CLOUDINARY_URL_RE } from '../../src/components/admin/ImageUploader.jsx'

afterEach(cleanup)

describe('CLOUDINARY_URL_RE', () => {
  it('acepta URLs de imágenes de Cloudinary', () => {
    expect(CLOUDINARY_URL_RE.test('https://res.cloudinary.com/drulik9bg/image/upload/v1777307717/foto.png')).toBe(true)
    expect(CLOUDINARY_URL_RE.test('https://res.cloudinary.com/demo/image/upload/w_800,c_fill/carpeta/x.jpg')).toBe(true)
  })
  it('rechaza otros dominios, http y videos', () => {
    expect(CLOUDINARY_URL_RE.test('http://res.cloudinary.com/demo/image/upload/x.jpg')).toBe(false)
    expect(CLOUDINARY_URL_RE.test('https://evil.com/res.cloudinary.com/image/upload/x.jpg')).toBe(false)
    expect(CLOUDINARY_URL_RE.test('https://res.cloudinary.com/demo/video/upload/x.mp4')).toBe(false)
  })
})

describe('ImageUploader', () => {
  it('agrega URLs válidas y las reporta en onChange', () => {
    const onChange = vi.fn()
    render(<ImageUploader onChange={onChange} />)
    const input = screen.getByPlaceholderText(/URLs de Cloudinary/)
    fireEvent.change(input, { target: { value: 'https://res.cloudinary.com/demo/image/upload/a.jpg https://res.cloudinary.com/demo/image/upload/b.jpg' } })
    fireEvent.click(screen.getByText('Agregar URL'))
    expect(onChange).toHaveBeenLastCalledWith({
      files: [],
      urls: ['https://res.cloudinary.com/demo/image/upload/a.jpg', 'https://res.cloudinary.com/demo/image/upload/b.jpg'],
    })
  })

  it('muestra error con una URL que no es de Cloudinary', () => {
    const onChange = vi.fn()
    render(<ImageUploader onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText(/URLs de Cloudinary/), { target: { value: 'https://imgur.com/x.jpg' } })
    fireEvent.click(screen.getByText('Agregar URL'))
    expect(screen.getByRole('alert').textContent).toMatch(/res\.cloudinary\.com/)
    expect(onChange).toHaveBeenLastCalledWith({ files: [], urls: [] })
  })

  it('respeta el máximo de imágenes', () => {
    render(<ImageUploader onChange={() => {}} maxImages={1} images={[{ id: 'i1', url: 'https://res.cloudinary.com/d/image/upload/x.jpg', isMain: true }]} />)
    expect(screen.getByPlaceholderText(/URLs de Cloudinary/).disabled).toBe(true)
  })
})
