"use client";
import { motion, useReducedMotion } from "framer-motion";

export function StaggerGrid({ children, className = "" }) {
  const reduced = useReducedMotion();
  const container = {
    hidden: {},
    visible: { transition: { staggerChildren: reduced ? 0 : 0.08, delayChildren: 0.1 } },
  };

  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className = "" }) {
  const item = {
    hidden: { opacity: 0, y: 24 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { type: "spring", stiffness: 120, damping: 20 },
    },
  };
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}