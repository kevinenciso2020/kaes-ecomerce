"use client";
import { motion } from "framer-motion";

const fadeSlideUp = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 100, damping: 20 },
  },
};

export function RevealSection({
  children,
  className = "",
  custom,
}) {
  return (
    <motion.div
      variants={fadeSlideUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      className={className}
      custom={custom}
    >
      {children}
    </motion.div>
  );
}