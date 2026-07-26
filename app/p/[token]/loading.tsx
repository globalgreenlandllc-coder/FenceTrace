/**
 * Route-level loading state for the public proposal portal. Server
 * component, CSS-only: mirrors the portal layout (nav, hero card,
 * package grid) with skeleton shimmer while the token lookup and
 * payment state resolve — no blank gap for homeowners on slow links.
 */
export default function PortalLoading() {
  return (
    <div className="relative">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="skeleton h-8 w-8 rounded-lg" />
            <div className="space-y-1.5">
              <div className="skeleton h-3.5 w-32 rounded" />
              <div className="skeleton h-2.5 w-16 rounded" />
            </div>
          </div>
          <div className="skeleton hidden h-5 w-40 rounded-full sm:block" />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:py-12">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card sm:p-8">
          <div className="flex flex-wrap items-start gap-4">
            <div className="skeleton h-16 w-16 rounded-2xl" />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="skeleton h-5 w-36 rounded-full" />
              <div className="skeleton h-9 w-3/4 max-w-xl rounded-lg" />
              <div className="skeleton h-4 w-1/2 max-w-md rounded" />
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card"
            >
              <div className="skeleton h-4 w-24 rounded" />
              <div className="skeleton mt-4 h-8 w-32 rounded-lg" />
              <div className="mt-5 space-y-2">
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-3 w-5/6 rounded" />
                <div className="skeleton h-3 w-2/3 rounded" />
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card">
          <div className="skeleton h-4 w-40 rounded" />
          <div className="skeleton mt-4 h-44 w-full rounded-xl" />
        </div>
      </main>
    </div>
  );
}
