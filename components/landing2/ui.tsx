import Link from "next/link";
import { clsx } from "clsx";
import { cn } from "@/lib/utils";

/** Tiny mono microlabel section eyebrow with a leading tick mark. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400",
        className,
      )}
    >
      <span className="inline-block h-[7px] w-[7px] rounded-[2px] bg-accent-600" />
      {children}
    </p>
  );
}

export function PillLink({
  href,
  children,
  variant = "dark",
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "dark" | "outline" | "light" | "accent";
  className?: string;
}) {
  return (
    <Link
      href={href}
      // cn (clsx + twMerge), not bare clsx — caller classNames must
      // deterministically override the variant classes (e.g. the dark
      // CTA panel's ghost overrides on the outline variant).
      className={cn(
        "ring-focus inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-[13px] font-semibold transition active:scale-[0.98] motion-reduce:transform-none",
        variant === "dark" &&
          "bg-accent-600 text-white shadow-sm hover:bg-accent-700",
        variant === "outline" &&
          "border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50",
        variant === "light" && "bg-white text-zinc-900 hover:bg-zinc-100",
        variant === "accent" && "bg-accent-500 text-white hover:bg-accent-400",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Standard landing content column. */
export function Container({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("mx-auto w-full max-w-[1200px] px-5 md:px-8", className)}>
      {children}
    </div>
  );
}

/**
 * Split section header used across the page: eyebrow on top, big heading on
 * the left, supporting paragraph (and optional action) on the right.
 */
export function SectionHeader({
  eyebrow,
  title,
  copy,
  action,
  dark,
}: {
  eyebrow: string;
  title: React.ReactNode;
  copy: React.ReactNode;
  action?: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div>
      <Eyebrow className={dark ? "text-white/40" : undefined}>{eyebrow}</Eyebrow>
      <div className="mt-6 grid gap-8 md:grid-cols-[1.15fr_0.85fr] md:items-end md:gap-16">
        <h2
          className={clsx(
            "text-[30px] font-semibold leading-[1.05] tracking-tight md:text-[40px]",
            dark ? "text-white" : "text-zinc-900",
          )}
        >
          {title}
        </h2>
        <div className="max-w-md md:justify-self-end">
          <p
            className={clsx(
              "text-[15px] leading-relaxed",
              dark ? "text-white/60" : "text-zinc-600",
            )}
          >
            {copy}
          </p>
          {action ? <div className="mt-6">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
