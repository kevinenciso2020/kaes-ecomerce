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
          <h2 className="cta-title">Tu estilo te espera</h2>
          <p className="cta-text">
            Usa el cupón <strong>TRINITY</strong> y obtén el 10% en tu primera compra.
          </p>
          <MagneticButton
            onClick={() => (window.location.href = "/auth/register")}
            className="btn cta-btn"
          >
            Crear cuenta
          </MagneticButton>
        </motion.div>
      </div>
    </section>
  );
}