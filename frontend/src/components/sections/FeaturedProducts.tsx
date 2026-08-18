"use client";
import { RevealSection } from "../motion/RevealSection";

const fadeSlideUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, type: "spring", stiffness: 100, damping: 20 },
  }),
};

function SkeletonCard() {
  return (
    <div className="product-card skeleton" aria-hidden="true">
      <div className="product-image skeleton-image" />
      <div className="product-info">
        <div className="skeleton-line skeleton-line-sm" />
        <div className="skeleton-line skeleton-line-md" />
        <div className="skeleton-line skeleton-line-lg" />
      </div>
    </div>
  );
}

export default function FeaturedProducts({
  products,
  loading = false,
}) {
  return (
    <section className="section featured-section" aria-label="Productos destacados">
      <div className="container">
        <RevealSection>
          <div className="section-header">
            <h2 className="section-title">Destacados</h2>
            <a href="/productos" className="see-all">
              Ver todos
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </RevealSection>

        <div className="products-grid">
          {loading && (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </>
          )}

          {!loading && products.length === 0 && (
            <div className="empty-state">
              <p>Pronto tendremos nuevos productos</p>
            </div>
          )}

          {!loading &&
            products.map((product, i) => {
              const img = product.images?.[0]?.url;
              const price = Number(product.price).toLocaleString("es-CO");

              return (
                <RevealSection key={product.slug} custom={i}>
                  <a
                    href={`/productos/${product.slug}`}
                    className="product-card"
                    aria-label={`Ver producto ${product.name}`}
                  >
                    <div className="product-image">
                      {img ? (
                        <img
                          src={img}
                          alt={product.name}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="product-placeholder">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                            <line x1="7" y1="7" x2="7.01" y2="7" />
                          </svg>
                        </div>
                      )}
                      <div className="product-overlay" />
                      {product.isFeatured && (
                        <span className="badge-featured">Destacado</span>
                      )}
                    </div>
                    <div className="product-info">
                      <p className="product-category">{product.category?.name}</p>
                      <h3 className="product-name">{product.name}</h3>
                      <p className="product-price">${price}</p>
                    </div>
                  </a>
                </RevealSection>
              );
            })}
        </div>
      </div>
    </section>
  );
}