// Mock compartido para upload.middleware.js que evita el fs.mkdir al import
// y expone el shape `productUpload.array(...)` que usan las rutas.
export const makeUploadMock = () => ({
  verifyMagicNumbers: vi.fn(),
  cleanupTempFiles: vi.fn(),
  productUpload: {
    array: (_field, _max) => (req, _res, next) => next(),
    single: (_field) => (req, _res, next) => next(),
    fields: (_fields) => (req, _res, next) => next(),
    any: () => (req, _res, next) => next(),
  },
  uploadConstants: {},
})

// Re-importamos vi para que esté disponible cuando se importe este módulo
import { vi } from 'vitest'