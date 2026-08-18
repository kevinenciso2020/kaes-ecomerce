"use client";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { useRef } from "react";

export function MagneticButton({ children, className = "", onClick, disabled }) {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 200, damping: 15, mass: 0.5 });
  const springY = useSpring(y, { stiffness: 200, damping: 15, mass: 0.5 });
  const prefersReducedMotion = useReducedMotion();

  const handleMove = (e) => {
    if (prefersReducedMotion || e.pointerType !== "mouse" || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    x.set(dx * 0.3);
    y.set(dy * 0.3);
  };

  const handleLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      ref={ref}
      style={{ x: springX, y: springY }}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onPointerCancel={handleLeave}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </motion.button>
  );
}