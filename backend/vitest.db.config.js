import { defineConfig } from 'vitest/config'

// Tests contra una base PostgreSQL REAL (no mocks): concurrencia, idempotencia
// de webhooks, cupones y transiciones de estado.
//
//   TEST_DATABASE_URL=postgresql://user@localhost:5432/kaes_test npm run test:db
//
// ⚠️ La base se vacía antes de cada test. NUNCA apuntes a producción.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.db.test.js'],
    globalSetup: ['./tests/db/global-setup.js'],
    setupFiles: ['./tests/db/setup.js'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000, // los TRUNCATE de beforeEach superan 10 s bajo carga
  },
})
