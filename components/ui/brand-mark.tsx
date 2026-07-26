import { cn } from "@/lib/utils";
import type { LogoTone } from "@/lib/auth-mock";

const TONE_BG: Record<LogoTone, string> = {
  emerald: "from-accent-500 to-accent-700",
  sky: "from-sky-500 to-sky-700",
  indigo: "from-indigo-500 to-indigo-700",
  rose: "from-rose-500 to-rose-700",
  amber: "from-amber-500 to-amber-700",
  violet: "from-violet-500 to-violet-700",
  zinc: "from-zinc-700 to-zinc-900",
};

const TONE_GLOW: Record<LogoTone, string> = {
  emerald: "shadow-[0_8px_24px_-8px_rgba(20,104,140,0.45)]",
  sky: "shadow-[0_8px_24px_-8px_rgba(2,132,199,0.45)]",
  indigo: "shadow-[0_8px_24px_-8px_rgba(67,56,202,0.45)]",
  rose: "shadow-[0_8px_24px_-8px_rgba(225,29,72,0.45)]",
  amber: "shadow-[0_8px_24px_-8px_rgba(217,119,6,0.45)]",
  violet: "shadow-[0_8px_24px_-8px_rgba(124,58,237,0.45)]",
  zinc: "shadow-[0_8px_24px_-8px_rgba(24,24,27,0.45)]",
};

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
  xl: "h-20 w-20 text-2xl",
} as const;

export function BrandMark({
  initials,
  tone,
  logoUrl,
  size = "md",
  rounded = "lg",
  className,
}: {
  initials: string;
  tone: LogoTone;
  logoUrl?: string | null;
  size?: keyof typeof SIZES;
  rounded?: "lg" | "xl" | "full";
  className?: string;
}) {
  const radius =
    rounded === "full"
      ? "rounded-full"
      : rounded === "xl"
      ? "rounded-2xl"
      : "rounded-xl";

  if (logoUrl) {
    return (
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden border border-zinc-200 bg-white shadow-sm",
          SIZES[size],
          radius,
          className,
        )}
      >
        <img
          src={logoUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center bg-gradient-to-br font-display font-semibold tracking-tight text-white",
        TONE_BG[tone],
        TONE_GLOW[tone],
        SIZES[size],
        radius,
        className,
      )}
    >
      <span className="relative z-10">
        {initials.slice(0, 3).toUpperCase()}
      </span>
      <span
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-tl from-transparent via-white/0 to-white/20",
          radius,
        )}
      />
    </div>
  );
}
