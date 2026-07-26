import { cn } from "@/lib/utils";

export function Avatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-600 text-xs font-semibold text-white shadow-sm",
        className,
      )}
    >
      {initials}
    </div>
  );
}
