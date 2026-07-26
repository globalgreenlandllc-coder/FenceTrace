import { cn } from "@/lib/utils";

type Tone = "accent" | "neutral" | "amber" | "rose" | "sky" | "violet" | "emerald";

const tones: Record<Tone, string> = {
  accent: "bg-accent-50 text-accent-700 border-accent-200/80",
  neutral: "bg-zinc-100 text-zinc-700 border-zinc-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function Badge({
  children,
  className,
  tone = "accent",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: Tone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors duration-150 motion-reduce:transition-none",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
