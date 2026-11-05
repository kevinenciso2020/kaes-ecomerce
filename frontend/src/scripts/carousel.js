// Comportamiento del carrusel de la home (ProductCarousel.astro), sin React.
//
// - Baraja los productos (intercalando categorías) en cada visita.
// - Repite la lista hasta llenar la pantalla y añade una copia exacta para que
//   el bucle no tenga saltos; las copias son aria-hidden y no reciben foco.
// - Avanza solo con requestAnimationFrame, pero ÚNICAMENTE mientras el carrusel
//   está en pantalla y la pestaña visible; se pausa con hover/foco y con el botón.
// - Flechas y deslizamiento táctil avanzan una tarjeta exacta.
// - Con prefers-reduced-motion no avanza solo.

import { repeatToFill, shuffleMixed } from '../lib/carousel.js'

// Segundos que tarda cada tarjeta en recorrer su propio ancho.
const SEGUNDOS_POR_TARJETA = 4.5
const DURACION_SALTO_MS = 450
const UMBRAL_SWIPE = 40

const mod = (x, m) => (m > 0 ? ((x % m) + m) % m : 0)
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

const marcarCopia = (li) => {
  li.classList.add('carousel-clone')
  li.setAttribute('aria-hidden', 'true')
  const a = li.querySelector('a')
  if (a) {
    a.tabIndex = -1
    a.removeAttribute('aria-label')
  }
  const img = li.querySelector('img')
  if (img) img.alt = ''
  return li
}

function initCarousel(root) {
  const viewport = root.querySelector('.carousel-viewport')
  const track = root.querySelector('.carousel-track')
  const controles = root.querySelector('.carousel-controls')
  const btnPausa = root.querySelector('[data-carousel-pause]')
  if (!viewport || !track) return

  const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // 1. Orden aleatorio y copias para el bucle.
  const originales = [...track.children].map((li) => ({ li, category: { slug: li.dataset.category } }))
  if (originales.length === 0) return
  const orden = shuffleMixed(originales).map((o) => o.li)
  const vuelta = repeatToFill(orden)
  const fragmento = document.createDocumentFragment()
  vuelta.forEach((li, i) => fragmento.append(i < orden.length ? li : marcarCopia(li.cloneNode(true))))
  vuelta.forEach((li) => fragmento.append(marcarCopia(li.cloneNode(true))))
  track.replaceChildren(fragmento)
  root.classList.add('is-enhanced')
  if (controles) controles.hidden = false

  // 2. Medidas (se recalculan si cambia el tamaño).
  let paso = 0   // ancho de una tarjeta + separación
  let ciclo = 0  // ancho de una vuelta completa
  const medir = () => {
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0
    const primera = track.firstElementChild
    paso = primera ? primera.getBoundingClientRect().width + gap : 0
    ciclo = (track.scrollWidth + gap) / 2
  }
  medir()
  new ResizeObserver(medir).observe(track)

  // 3. Estado y bucle de animación.
  let offset = 0
  let salto = null
  let pausado = false
  let encima = false
  let enPantalla = false
  let raf = 0
  let ultimo = 0

  const frame = (ahora) => {
    const dt = Math.min(ahora - ultimo, 50)
    ultimo = ahora
    if (salto) {
      const t = Math.min(1, (ahora - salto.inicio) / salto.duracion)
      offset = salto.desde + (salto.hasta - salto.desde) * easeOutCubic(t)
      if (t >= 1) salto = null
    } else if (!reducido && !pausado && !encima && paso > 0) {
      offset += (paso / SEGUNDOS_POR_TARJETA) * (dt / 1000)
    }
    const x = mod(offset, ciclo)
    if (!salto) offset = x
    track.style.transform = `translate3d(${-x}px, 0, 0)`
    raf = requestAnimationFrame(frame)
  }

  const arrancar = () => {
    if (raf || !enPantalla || document.hidden) return
    ultimo = performance.now()
    raf = requestAnimationFrame(frame)
  }
  const detener = () => {
    cancelAnimationFrame(raf)
    raf = 0
  }

  new IntersectionObserver(
    ([e]) => {
      enPantalla = e.isIntersecting
      enPantalla ? arrancar() : detener()
    },
    { rootMargin: '100px' },
  ).observe(viewport)
  document.addEventListener('visibilitychange', () => (document.hidden ? detener() : arrancar()))

  // 4. Controles.
  const mover = (dir) => {
    if (!paso) return
    const base = salto ? salto.hasta : offset
    salto = { desde: offset, hasta: base + dir * paso, inicio: performance.now(), duracion: reducido ? 1 : DURACION_SALTO_MS }
    arrancar()
  }
  root.querySelector('[data-carousel-prev]')?.addEventListener('click', () => mover(-1))
  root.querySelector('[data-carousel-next]')?.addEventListener('click', () => mover(1))
  btnPausa?.addEventListener('click', () => {
    pausado = !pausado
    btnPausa.setAttribute('aria-pressed', String(pausado))
    btnPausa.setAttribute('aria-label', pausado ? 'Reanudar carrusel' : 'Pausar carrusel')
  })

  viewport.addEventListener('mouseenter', () => { encima = true })
  viewport.addEventListener('mouseleave', () => { encima = false })
  viewport.addEventListener('focusin', () => { encima = true })
  viewport.addEventListener('focusout', () => { encima = false })

  let toqueX = null
  viewport.addEventListener('touchstart', (e) => { toqueX = e.touches[0]?.clientX ?? null }, { passive: true })
  viewport.addEventListener('touchend', (e) => {
    const inicio = toqueX
    toqueX = null
    const fin = e.changedTouches[0]?.clientX
    if (inicio == null || fin == null) return
    const dx = fin - inicio
    if (Math.abs(dx) >= UMBRAL_SWIPE) mover(dx < 0 ? 1 : -1)
  })
}

export function initCarousels() {
  document.querySelectorAll('[data-carousel]').forEach(initCarousel)
}
