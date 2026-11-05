// Animación de entrada al hacer scroll (sustituye a framer-motion `whileInView`).
//
// Solo se ocultan los elementos [data-reveal] que todavía NO están en pantalla
// cuando corre el script, así que sin JavaScript (o si falla) todo se ve normal
// y no hay parpadeo en lo que ya es visible. Cada elemento se anima una sola vez.
// El retardo escalonado sale de la variable CSS --reveal-i (ver index.css).

const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches

if (!reducido && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue
        e.target.classList.add('is-revealed')
        io.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -60px 0px' },
  )

  for (const el of document.querySelectorAll('[data-reveal]')) {
    const r = el.getBoundingClientRect()
    if (r.top < window.innerHeight && r.bottom > 0) continue
    el.classList.add('reveal-pending')
    io.observe(el)
  }
}
