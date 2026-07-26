/**
 * Shared route-level skeleton for every /admin page. All admin routes
 * block on force-dynamic DB fetches — without this, navigation is a
 * dead pause. Shape mirrors the common page anatomy: header, KPI
 * strip, table card with rows.
 */
export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="skeleton h-9 w-64 rounded-lg" />
          <div className="skeleton mt-2 h-4 w-96 max-w-full rounded-md" />
        </div>
        <div className="skeleton h-6 w-40 rounded-full" />
      </header>

      <section className="surface grid grid-cols-1 divide-y divide-zinc-100 shadow-card sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-5 py-4">
            <div className="skeleton h-4 w-28 rounded-md" />
            <div className="skeleton mt-3 h-7 w-20 rounded-md" />
            <div className="skeleton mt-2 h-3 w-24 rounded-md" />
          </div>
        ))}
      </section>

      <section className="surface overflow-hidden shadow-card">
        <div className="border-b border-zinc-100 px-4 py-4">
          <div className="skeleton h-5 w-44 rounded-md" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-zinc-100 px-4 py-3.5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <div className="skeleton h-4 w-48 max-w-full rounded-md" />
              <div className="skeleton mt-1.5 h-3 w-64 max-w-full rounded-md" />
            </div>
            <div className="skeleton hidden h-5 w-20 rounded-full sm:block" />
            <div className="skeleton hidden h-5 w-16 rounded-full sm:block" />
            <div className="skeleton h-4 w-14 rounded-md" />
          </div>
        ))}
      </section>
    </div>
  );
}
