"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Fade + rise scroll reveal (once). Server sections wrap their key blocks in
 * this; children stay server-rendered.
 *
 * Reduced motion must NOT swap to a plain div: the server render (where
 * useReducedMotion() is null) bakes `opacity:0` into the HTML, and a
 * different element tree on hydration would leave that stale style in
 * place forever — blanking the section. Always render the motion.div and
 * give framer explicit resting values so its mount render overwrites the
 * server style with visible, static content.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}
