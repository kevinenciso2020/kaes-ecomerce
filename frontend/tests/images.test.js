import { describe, it, expect } from 'vitest'
import { cloudinaryUrl, cloudinarySrcset } from '../src/lib/images.js'

const URL_CLD = 'https://res.cloudinary.com/demo/image/upload/v123/camiseta.png'

describe('images: cloudinaryUrl', () => {
  it('agrega formato, calidad automática y ancho', () => {
    expect(cloudinaryUrl(URL_CLD, { width: 480 }))
      .toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_480/v123/camiseta.png')
  })

  it('sin ancho solo optimiza formato y calidad', () => {
    expect(cloudinaryUrl(URL_CLD)).toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit/v123/camiseta.png')
  })

  it('no toca otros orígenes, recursos privados ni valores vacíos', () => {
    expect(cloudinaryUrl('https://example.com/a.png', { width: 100 })).toBe('https://example.com/a.png')
    const privada = 'https://res.cloudinary.com/demo/image/authenticated/s--x--/v1/comprobante.jpg'
    expect(cloudinaryUrl(privada, { width: 100 })).toBe(privada)
    expect(cloudinaryUrl(undefined)).toBeUndefined()
    expect(cloudinaryUrl('')).toBe('')
  })
})

describe('images: cloudinarySrcset', () => {
  it('genera un candidato por ancho', () => {
    const s = cloudinarySrcset(URL_CLD, [320, 640])
    expect(s).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_320/v123/camiseta.png 320w, ' +
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_640/v123/camiseta.png 640w',
    )
  })

  it('sin Cloudinary no hay srcset', () => {
    expect(cloudinarySrcset('https://example.com/a.png', [320])).toBeUndefined()
  })
})
