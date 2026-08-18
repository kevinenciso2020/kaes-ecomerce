"use client";
import { motion, useReducedMotion } from "framer-motion";
import { MagneticButton } from "../motion/MagneticButton";

export default function CtaBanner() {
  const reduced = useReducedMotion();

  return (
    <section className="cta-banner" aria-label="Promoción">
      <div className="container">
        <motion.div
          className="cta-inner"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ type: "spring", stiffness: 100, damping: 20 }}
        >
          <p className="cta-eyebrow">Primera compra</p>
          <h2 className="cta-title">Tu estilo te espera</h2>
          <p className="cta-text">
            Usa el cupón <strong>BIENVENIDO10</strong> y obtén 10% de descuento en tu primera orden.
          </p>
          <MagneticButton
            onClick={() => (window.location.href = "/auth/register")}
            className="btn cta-btn"
          >
            Crear cuenta gratis
          </MagneticButton>
        </motion.div>
      </div>
    </section>
  );
}