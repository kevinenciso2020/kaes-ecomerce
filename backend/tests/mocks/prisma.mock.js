import { vi } from 'vitest'

const createModelMock = () => {
  const model = {}
  return new Proxy(model, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (prop === '$transaction' || prop === '$disconnect' || prop === '$queryRaw') {
        return vi.fn()
      }
      return vi.fn()
    },
  })
}

export const mockPrisma = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined
      return createModelMock()
    },
  },
)

export const resetMockPrisma = () => {
  for (const key of Object.keys(mockPrisma)) {
    if (typeof mockPrisma[key] === 'object' && mockPrisma[key] !== null) {
      for (const fn of Object.values(mockPrisma[key])) {
        if (typeof fn?.mockReset === 'function') fn.mockReset()
      }
    }
  }
}