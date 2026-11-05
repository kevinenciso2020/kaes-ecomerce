// Botones "magnéticos" (sustituye a MagneticButton de framer-motion): con el
// mouse encima, el botón se desplaza un 30 % hacia el puntero y vuelve con un
// rebote suave (transición CSS en [data-magnetic], ver index.css). En táctil o
// con movimiento reducido no hace nada.

const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const FUERZA = 0.3

if (!reducido) {
  for (const el of document.querySelectorAll('[data-magnetic]')) {
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return
      const r = el.getBoundingClientRect()
      const dx = e.clientX - (r.left + r.width / 2)
      const dy = e.clientY - (r.top + r.height / 2)
      el.style.transform = `translate(${dx * FUERZA}px, ${dy * FUERZA}px)`
    })
    const soltar = () => { el.style.transform = '' }
    el.addEventListener('pointerleave', soltar)
    el.addEventListener('pointercancel', soltar)
  }
}
