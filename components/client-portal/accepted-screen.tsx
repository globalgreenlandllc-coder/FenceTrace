"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
  CalendarClock,
  Check,
  CreditCard,
  ExternalLink,
  FileText,
  Mail,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { formatCurrency } from "@/lib/utils";
import { DUR, EASE, fadeInUp, staggerContainer } from "@/lib/motion";

/** Celebration pop for the check circle — the one gently springy moment
 *  in the portal. Plays once, on acceptance; everything after it settles
 *  with the house ease-out. */
const checkPop: Variants = {
  hidden: { scale: 0.6, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: { type: "spring", damping: 18, stiffness: 240 },
  },
};

export function AcceptedScreen({
  packageName,
  amount,
  contractor,
  signerName,
}: {
  packageName: string;
  amount: number;
  contractor: {
    name: string;
    company: string;
    email: string;
    stripePaymentUrl?: string | null;
    squarePaymentUrl?: string | null;
  };
  signerName: string;
}) {
  const stripeUrl = contractor.stripePaymentUrl ?? null;
  const squareUrl = contractor.squarePaymentUrl ?? null;
  const hasPayment = !!(stripeUrl || squareUrl);
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DUR.slow, ease: EASE }}
      className="relative min-h-screen overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_70%)]" />

      <motion.div
        initial={reduce ? false : "hidden"}
        animate="visible"
        variants={staggerContainer(0.07, 0.1)}
        className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 py-16"
      >
        <Logo />
        <motion.div
          variants={checkPop}
          className="mt-10 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200 shadow-card"
        >
          <Check className="h-10 w-10" />
        </motion.div>

        <motion.h1
          variants={fadeInUp}
          className="mt-6 text-balance text-center text-4xl font-semibold tracking-tight text-zinc-900"
        >
          You're all set,{" "}
          <span className="text-accent-700">
            {signerName.split(" ")[0]}
          </span>
          .
        </motion.h1>
        <motion.p
          variants={fadeInUp}
          className="mt-3 max-w-md text-center text-zinc-600"
        >
          {contractor.company} received your signed proposal.{" "}
          {hasPayment
            ? `Pay ${formatCurrency(amount)} below to lock in scheduling.`
            : `${contractor.name} will reach out shortly to arrange payment and scheduling.`}
        </motion.p>

        {hasPayment && (
          <motion.div
            variants={fadeInUp}
            className="mt-6 flex w-full flex-col items-stretch gap-2 sm:max-w-md"
          >
            {stripeUrl && (
              <PayButton
                href={stripeUrl}
                label={`Pay ${formatCurrency(amount)} with Stripe`}
                variant="primary"
              />
            )}
            {squareUrl && (
              <PayButton
                href={squareUrl}
                label={`Pay ${formatCurrency(amount)} with Square`}
                variant={stripeUrl ? "secondary" : "primary"}
              />
            )}
            <p className="text-center text-xs text-zinc-500">
              Opens {contractor.company}'s secure payment page in a new tab.
            </p>
          </motion.div>
        )}

        <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile icon={Mail} title="Receipt" body="Check your inbox" />
          <Tile
            icon={CalendarClock}
            title="Scheduling"
            body={`${contractor.name} will reach out within 24 hours`}
          />
          <Tile
            icon={FileText}
            title="Documents"
            body="Signed proposal saved to your portal"
          />
        </div>

        <motion.div
          variants={fadeInUp}
          className="mt-10 rounded-2xl border border-zinc-200 bg-white p-5 text-center text-sm text-zinc-600 shadow-card"
        >
          Selected:{" "}
          <span className="font-medium text-zinc-900">{packageName}</span> ·
          Paid today:{" "}
          <span className="font-medium text-zinc-900">
            {formatCurrency(amount)}
          </span>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

function Tile({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <motion.div
      variants={fadeInUp}
      className="rounded-xl border border-zinc-200 bg-white p-4 shadow-card"
    >
      <Icon className="h-5 w-5 text-accent-700" />
      <div className="mt-2 font-medium text-zinc-900">{title}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{body}</div>
    </motion.div>
  );
}

function PayButton({
  href,
  label,
  variant,
}: {
  href: string;
  label: string;
  variant: "primary" | "secondary";
}) {
  const cls =
    variant === "primary"
      ? "bg-accent-600 text-white hover:bg-accent-500"
      : "border border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={`transition-smooth press-scale ring-focus inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium shadow-card ${cls}`}
    >
      <CreditCard className="h-4 w-4" />
      {label}
      <ExternalLink className="h-3.5 w-3.5 opacity-70" />
    </a>
  );
}
