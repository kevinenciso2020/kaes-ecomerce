// Vitest se ejecuta por defecto en jsdom, así que `window` y `localStorage`
// ya están disponibles. Sólo necesitamos limpiarlos antes de cada test.

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.clear()
  }
})