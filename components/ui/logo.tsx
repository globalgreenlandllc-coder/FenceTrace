import { cn } from "@/lib/utils";

/**
 * Hyperline-style logotype: heavy uppercase wordmark followed by a filled
 * square. Inherits color via text-* so it works on light and dark surfaces
 * (defaults to ink).
 */
export function Logo({
  className,
  showSubtitle = true,
}: {
  className?: string;
  showSubtitle?: boolean;
}) {
  return (
    <div className={cn("flex flex-col leading-none text-ink", className)}>
      <span className="flex items-center gap-1.5">
        <span className="font-display text-[17px] uppercase tracking-[-0.01em]">
          Fencetrace
        </span>
        <span
          aria-hidden
          className="inline-block h-[0.55em] w-[0.55em] bg-current"
        />
      </span>
      {showSubtitle && (
        <span className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.28em] opacity-50">
          AI Takeoff
        </span>
      )}
    </div>
  );
}
