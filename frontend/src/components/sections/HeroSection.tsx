"use client";
import { motion, useReducedMotion } from "framer-motion";
import { MagneticButton } from "../motion/MagneticButton";

const fadeSlideUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, type: "spring", stiffness: 100, damping: 20 },
  }),
};

const drawStatic = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { duration: 2, ease: "easeInOut" },
      opacity: { duration: 0.5 },
    },
  },
};

const drawLoop = {
  hidden: { pathLength: 0, pathOffset: 1, opacity: 0 },
  visible: {
    pathLength: 1,
    pathOffset: 0,
    opacity: 1,
    transition: {
      pathLength: { duration: 2, ease: "easeInOut" },
      pathOffset: { duration: 4, ease: "linear", repeat: Infinity },
      opacity: { duration: 0.5 },
    },
  },
};

export default function HeroSection() {
  const prefersReducedMotion = useReducedMotion();
  const draw = prefersReducedMotion ? drawStatic : drawLoop;

  return (
    <section className="hero-section">
      <div className="hero-bg-pattern" aria-hidden="true" />

      <div className="hero-inner container">
        <div className="hero-left">
          <div className="hero-symbol-wrapper">
            <svg
              className="hero-symbol"
              viewBox="0 0 950 850"
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
            >
              <motion.path
                d="M 433 0 A 440 440 90 0 0 866 750 A 440 440 90 0 0 0 750 A 440 440 90 0 0 433 0 Z"
                transform="translate(40 40)"
                fill="none"
                stroke="var(--color-black)"
                strokeWidth="35"
                strokeLinecap="round"
                strokeDasharray="40 60"
                variants={draw}
                initial="hidden"
                animate="visible"
              />
            </svg>
          </div>
        </div>

        <div className="hero-right">
          <motion.p
            className="hero-eyebrow"
            custom={0}
            initial="hidden"
            animate="visible"
            variants={fadeSlideUp}
          >
            simply eternal
          </motion.p>

          <motion.h1
            className="hero-title"
            custom={1}
            initial="hidden"
            animate="visible"
            variants={fadeSlideUp}
          >
            <span className="hero-title-kaes">kaes</span>
          </motion.h1>

          <motion.p
            className="hero-tagline"
            custom={2}
            initial="hidden"
            animate="visible"
            variants={fadeSlideUp}
          >
            Ropa con personalidad
          </motion.p>

          <motion.p
            className="hero-subtitle"
            custom={3}
            initial="hidden"
            animate="visible"
            variants={fadeSlideUp}
          >
            Cada prenda nace desde lo esencial y evoluciona contigo.
          </motion.p>

          <motion.div
            className="hero-actions"
            custom={4}
            initial="hidden"
            animate="visible"
            variants={fadeSlideUp}
          >
            <MagneticButton
              onClick={() => (window.location.href = "/productos")}
              className="btn btn-primary hero-btn-primary"
            >
              Explorar colección
            </MagneticButton>
            <a href="/auth/register" className="btn btn-outline hero-btn-outline">
              Crear cuenta
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}