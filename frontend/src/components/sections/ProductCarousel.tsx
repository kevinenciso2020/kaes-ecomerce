"use client";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import {
  availableColors,
  availableSizes,
  priceInfo,
  repeatToFill,
  shuffleMixed,
} from "../../lib/carousel.js";

// Segundos que tarda cada tarjeta en recorrer su propio ancho: velocidad
// pausada, en línea con el resto de animaciones de la página.
const SEGUNDOS_POR_TARJETA = 4.5;
// Duración del salto al usar las flechas.
const DURACION_SALTO_MS = 450;
// Píxeles mínimos de deslizamiento táctil para contar como gesto.
const UMBRAL_SWIPE = 40;

const formatCOP = (n) => `$${Number(n).toLocaleString("es-CO")}`;
const mod = (x, m) => (m > 0 ? ((x % m) + m) % m : 0);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function CarouselCard({ product, clone }) {
  const img = product.images?.[0]?.url;
  const { price, final, hasOffer, offerPct } = priceInfo(product);
  const tallas = availableSizes(product);
  const colores = availableColors(product);

  return (
    <li className={`carousel-item${clone ? " carousel-clone" : ""}`} aria-hidden={clone || undefined}>
      <a
        href={`/productos/${product.slug}`}
        className="product-card carousel-card"
        aria-label={clone ? undefined : `Ver producto ${product.name}`}
        tabIndex={clone ? -1 : undefined}
        draggable={false}
      >
        <div className="product-image">
          {img ? (
            <img src={img} alt={clone ? "" : product.name} loading="lazy" decoding="async" draggable={false} />
          ) : (
            <div className="product-placeholder">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
            </div>
          )}
          <div className="product-overlay" />
          {hasOffer && <span className="badge-featured carousel-offer">-{offerPct}%</span>}
        </div>
        <div className="product-info">
          <p className="product-category">{product.category?.name}</p>
          <h3 className="product-name">{product.name}</h3>
          <p className="product-price">
            {hasOffer && <s className="carousel-old-price">{formatCOP(price)}</s>}
            {formatCOP(final)}
          </p>
          {(tallas.length > 0 || colores.length > 0) && (
            <p className="carousel-meta">
              {tallas.length > 0 && <span>Tallas {tallas.join(" · ")}</span>}
              {colores.length > 0 && <span>{colores.join(" · ")}</span>}
            </p>
          )}
        </div>
      </a>
    </li>
  );
}

export default function ProductCarousel({ products = [] }) {
  // El HTML del servidor sale en el orden de la API (la página se cachea en el
  // borde); al montar se baraja en el navegador para que cada visita sea distinta.
  const [order, setOrder] = useState(products);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();

  const trackRef = useRef(null);
  const offsetRef = useRef(0);       // px desplazados (crece hacia la izquierda)
  const loopRef = useRef(0);         // ancho de una vuelta completa
  const stepRef = useRef(0);         // ancho de una tarjeta + separación
  const tweenRef = useRef(null);     // salto en curso de las flechas
  const hoverRef = useRef(false);    // mouse o foco dentro del carrusel
  const pausedRef = useRef(false);
  const touchXRef = useRef(null);

  useEffect(() => {
    setOrder(shuffleMixed(products));
    setReady(true);
  }, [products]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Medidas: se recalculan cuando cambia el tamaño (rotación, zoom, fuentes).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const medir = () => {
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      const primera = track.firstElementChild;
      stepRef.current = primera ? primera.getBoundingClientRect().width + gap : 0;
      // La pista son dos vueltas idénticas: una vuelta = mitad + medio gap.
      loopRef.current = (track.scrollWidth + gap) / 2;
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(track);
    return () => ro.disconnect();
  }, [order]);

  // Bucle de animación: avanza solo salvo pausa, hover/foco o movimiento
  // reducido; los saltos de las flechas tienen prioridad.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let raf = 0;
    let last = performance.now();

    const frame = (now) => {
      const dt = Math.min(now - last, 50); // pestaña oculta: no "saltar" al volver
      last = now;
      const tween = tweenRef.current;

      if (tween) {
        const t = Math.min(1, (now - tween.start) / tween.duration);
        offsetRef.current = tween.from + (tween.to - tween.from) * easeOutCubic(t);
        if (t >= 1) tweenRef.current = null;
      } else if (!reduced && !pausedRef.current && !hoverRef.current && stepRef.current > 0) {
        offsetRef.current += (stepRef.current / SEGUNDOS_POR_TARJETA) * (dt / 1000);
      }

      const x = mod(offsetRef.current, loopRef.current);
      if (!tweenRef.current) offsetRef.current = x;
      track.style.transform = `translate3d(${-x}px, 0, 0)`;
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced, order]);

  const mover = (dir) => {
    const step = stepRef.current;
    if (!step) return;
    const desde = offsetRef.current;
    // Si ya hay un salto en curso, se encadena desde su destino.
    const base = tweenRef.current ? tweenRef.current.to : desde;
    tweenRef.current = {
      from: desde,
      to: base + dir * step,
      start: performance.now(),
      duration: reduced ? 1 : DURACION_SALTO_MS,
    };
  };

  if (products.length === 0) return null;

  // Una "vuelta" (lista repetida hasta llenar la pantalla) + su copia exacta
  // para que el bucle no tenga saltos visibles.
  const vuelta = repeatToFill(order);
  const pista = [...vuelta, ...vuelta];

  return (
    <section className="section carousel-section" aria-label="Productos disponibles" aria-roledescription="carrusel">
      <div
        className={`carousel-viewport${ready ? " is-ready" : ""}`}
        onMouseEnter={() => { hoverRef.current = true; }}
        onMouseLeave={() => { hoverRef.current = false; }}
        onFocus={() => { hoverRef.current = true; }}
        onBlur={() => { hoverRef.current = false; }}
        onTouchStart={(e) => { touchXRef.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const inicio = touchXRef.current;
          touchXRef.current = null;
          const fin = e.changedTouches[0]?.clientX;
          if (inicio == null || fin == null) return;
          const dx = fin - inicio;
          if (Math.abs(dx) >= UMBRAL_SWIPE) mover(dx < 0 ? 1 : -1);
        }}
      >
        <ul className="carousel-track" ref={trackRef}>
          {pista.map((product, i) => (
            <CarouselCard key={`${product.slug}-${i}`} product={product} clone={i >= order.length} />
          ))}
        </ul>
      </div>

      <div className="carousel-controls">
        <button type="button" className="carousel-btn" onClick={() => mover(-1)} aria-label="Producto anterior">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          type="button"
          className="carousel-btn carousel-btn-main carousel-pause"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          aria-label={paused ? "Reanudar carrusel" : "Pausar carrusel"}
        >
          {paused ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
          )}
        </button>
        <button type="button" className="carousel-btn" onClick={() => mover(1)} aria-label="Producto siguiente">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <a href="/productos" className="see-all carousel-see-all">
        Ver todos
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </a>
    </section>
  );
}
