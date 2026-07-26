/**
 * Motion building blocks for client components (framer-motion).
 *
 * Pure data module — no "use client", no side effects. Import ONLY from
 * files that already start with "use client"; server components use the
 * CSS utilities in app/globals.css instead (.anim-enter, .hover-lift, …).
 *
 * Reduced-motion contract (repo-sanctioned pattern): components vary ONLY
 * the `initial` prop via useReducedMotion — never render a different tree:
 *
 *   const reduce = useReducedMotion();
 *   <motion.div
 *     initial={reduce ? false : "hidden"}
 *     animate="visible"
 *     variants={fadeInUp}
 *   />
 */
import type { Transition, Variants } from "framer-motion";

/** Core UI durations in seconds. Keep interactive UI in the 0.15–0.3 band;
 *  `entrance` is for one-shot mount/scroll reveals only. */
export const DUR = {
  fast: 0.15,
  base: 0.2,
  slow: 0.3,
  entrance: 0.4,
} as const;

/** House ease-out curve — smooth settle, zero overshoot. */
export const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** Subtle near-critically-damped spring for drawers/slide-overs.
 *  No visible bounce — matches the PaymentsDrawer feel. */
export const SPRING: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
  mass: 0.9,
};

/** Standard entrance: fade + 12px rise. Use with initial="hidden" animate="visible". */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.entrance, ease: EASE },
  },
};

/** Opacity-only entrance for dense rows/lists (no vertical shift). */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DUR.slow, ease: EASE },
  },
};

/** Parent variants that stagger `fadeInUp`/`fadeIn` children.
 *  Usage: <motion.ul variants={staggerContainer()} initial={...} animate="visible">
 *  with children carrying variants={fadeInUp} and NO initial/animate of their own. */
export const staggerContainer = (
  stagger = 0.05,
  delayChildren = 0,
): Variants => ({
  hidden: {},
  visible: {
    transition: { staggerChildren: stagger, delayChildren },
  },
});

/** viewport prop for whileInView reveals — fires once, slightly before
 *  the element is fully in view (matches the landing Reveal convention). */
export const viewportOnce = { once: true, margin: "-60px" } as const;
