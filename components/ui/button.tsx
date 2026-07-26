"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger"
  | "dark"
  | "gradient";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 motion-reduce:transition-none ring-focus disabled:opacity-50 disabled:cursor-not-allowed select-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent-600 text-white font-semibold shadow-sm hover:bg-accent-700 active:translate-y-px",
  secondary:
    "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 shadow-sm active:translate-y-px",
  ghost:
    "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 active:translate-y-px",
  outline:
    "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 active:translate-y-px",
  danger:
    "bg-rose-600 text-white font-semibold shadow-sm hover:bg-rose-700 active:translate-y-px",
  dark: "bg-accent-950 text-white font-semibold hover:bg-accent-900 active:translate-y-px",
  gradient:
    "bg-accent-600 text-white font-semibold shadow-sm hover:bg-accent-700 active:translate-y-px",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-[13px]",
  md: "h-11 px-5 text-sm",
  lg: "h-14 px-7 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
