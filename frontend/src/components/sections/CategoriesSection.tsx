"use client";
import { StaggerGrid, StaggerItem } from "../motion/StaggerGrid";

const categories = [
  {
    name: "Camisetas",
    slug: "camisetas",
    ariaLabel: "Ver categoría Camisetas",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 4l-4 4-4-4H4l4 6v10h8V10l4-6h-4z" />
        <path d="M10 4.2c0 1.4.9 2.3 2 2.3s2-.9 2-2.3" />
      </svg>
    ),
  },
  {
    name: "Pantalones",
    slug: "pantalones",
    ariaLabel: "Ver categoría Pantalones",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h16v2l-2 14h-4l-1-7h-2l-1 7H6L4 6V4z" />
        <line x1="4" y1="6" x2="20" y2="6" />
      </svg>
    ),
  },
  {
    name: "Shorts",
    slug: "shorts",
    ariaLabel: "Ver categoría Shorts",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h16v2l-2 8h-4l-1-3h-2l-1 3H6L4 6V4z" />
        <line x1="4" y1="6" x2="20" y2="6" />
      </svg>
    ),
  },
  {
    name: "Accesorios",
    slug: "accesorios",
    ariaLabel: "Ver categoría Accesorios",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 9h14l-1 11H6L5 9z" />
        <path d="M8 9V7a4 4 0 018 0v2" />
        <circle cx="12" cy="14.5" r="0.9" fill="currentColor" />
      </svg>
    ),
  },
];

export default function CategoriesSection() {
  return (
    <section className="section categories-section" aria-label="Categorías">
      <div className="container">
        <StaggerGrid className="categories-grid">
          {categories.map((cat) => (
            <StaggerItem key={cat.slug}>
              <a
                href={`/productos?category=${cat.slug}`}
                className="category-card"
                aria-label={cat.ariaLabel}
              >
                <div className="category-icon">{cat.icon}</div>
                <span className="category-name">{cat.name}</span>
              </a>
            </StaggerItem>
          ))}
        </StaggerGrid>
      </div>
    </section>
  );
}