"use client";
import { StaggerGrid, StaggerItem } from "../motion/StaggerGrid";

const categories = [
  {
    name: "Camisetas",
    slug: "camisetas",
    ariaLabel: "Ver categoría Camisetas",
  },
  {
    name: "Pantalones",
    slug: "pantalones",
    ariaLabel: "Ver categoría Pantalones",
  },
  {
    name: "Shorts",
    slug: "shorts",
    ariaLabel: "Ver categoría Shorts",
  },
  {
    name: "Accesorios",
    slug: "accesorios",
    ariaLabel: "Ver categoría Accesorios",
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
                <span className="category-name">{cat.name}</span>
              </a>
            </StaggerItem>
          ))}
        </StaggerGrid>
      </div>
    </section>
  );
}