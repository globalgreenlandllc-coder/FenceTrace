import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-zinc-200/70 bg-white shadow-card transition-[border-color,box-shadow,transform] duration-200 motion-reduce:transition-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
