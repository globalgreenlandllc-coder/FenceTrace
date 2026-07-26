/** Route skeleton for /worker — mirrors the My Jobs header, tab pill, and
 *  card grid so the layout doesn't jump when real data lands. Server
 *  component: shimmer comes from the .skeleton utility (CSS only). */
export default function WorkerJobsLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="skeleton h-6 w-28" />
        <div className="skeleton h-4 w-72 max-w-full" />
      </div>

      <div className="skeleton h-10 w-72 max-w-full rounded-xl" />

      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <div className="space-y-2.5 px-4 pt-4">
              <div className="skeleton h-5 w-24 rounded-full" />
              <div className="skeleton h-5 w-3/4" />
            </div>
            <div className="space-y-2 px-4 py-3">
              <div className="skeleton h-3.5 w-1/2" />
              <div className="skeleton h-3.5 w-2/3" />
              <div className="skeleton h-3.5 w-2/5" />
            </div>
            <div className="mt-auto flex items-center justify-between border-t border-zinc-100 bg-zinc-50/60 px-4 py-2.5">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-5 w-14" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
