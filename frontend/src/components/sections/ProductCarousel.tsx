"use client";
import { useEffect, useState } from "react";
import {
  availableColors,
  availableSizes,
  priceInfo,
  repeatToFill,
  shuffleMixed,
} from "../../lib/carousel.js";

// Segundos que tarda cada tarjeta en recorrer su ancho: velocidad pausada,
// en línea con el resto de animaciones de la página.
const SEGUNDOS_POR_TARJETA = 4.5;

const formatCOP = (n) => `$${Number(n).toLocaleString("es-CO")}`;

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

  useEffect(() => {
    setOrder(shuffleMixed(products));
    setReady(true);
  }, [products]);

  if (products.length === 0) return null;

  // Una "vuelta" (lista repetida hasta llenar la pantalla) + su copia exacta:
  // la animación se desplaza -50% y vuelve a empezar sin salto visible.
  const vuelta = repeatToFill(order);
  const pista = [...vuelta, ...vuelta];
  const duracion = `${vuelta.length * SEGUNDOS_POR_TARJETA}s`;

  return (
    <section className="section carousel-section" aria-label="Productos disponibles">
      <div className="container">
        <div className="section-header">
          <h2 className="section-title">Disponibles ahora</h2>
          <div className="carousel-actions">
            <button
              type="button"
              className="carousel-toggle"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              aria-label={paused ? "Reanudar carrusel" : "Pausar carrusel"}
            >
              {paused ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
              )}
            </button>
            <a href="/productos" className="see-all">
              Ver todos
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      <div className={`carousel-viewport${ready ? " is-ready" : ""}${paused ? " is-paused" : ""}`}>
        <ul className="carousel-track" style={{ "--carousel-duration": duracion }}>
          {pista.map((product, i) => (
            <CarouselCard key={`${product.slug}-${i}`} product={product} clone={i >= order.length} />
          ))}
        </ul>
      </div>
    </section>
  );
}
