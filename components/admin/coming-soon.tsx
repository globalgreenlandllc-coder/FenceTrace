import { Badge } from "@/components/ui/badge";

export function ComingSoon({
  title,
  description,
  bullets,
}: {
  title: string;
  description: string;
  bullets: string[];
}) {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
          {title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">{description}</p>
      </header>

      <div className="surface bg-paper/60 p-10 text-center">
        <Badge tone="amber" className="font-label text-[10px]">
          In progress
        </Badge>
        <h2 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900">
          Shipping in the next admin commit
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          The schema is ready in Postgres. The UI is queued.
        </p>

        <ul className="mx-auto mt-6 max-w-md space-y-2 text-left text-sm text-zinc-600">
          {bullets.map((b) => (
            <li
              key={b}
              className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2"
            >
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
