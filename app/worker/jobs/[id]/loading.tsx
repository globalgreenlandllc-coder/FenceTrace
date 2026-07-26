/** Route skeleton for /worker/jobs/[id] — back link, title + pay chip,
 *  fence canvas, stat tiles, and the two detail cards. Server component:
 *  shimmer comes from the .skeleton utility (CSS only). */
export default function WorkerJobLoading() {
  return (
    <div className="space-y-5">
      <div className="skeleton h-4 w-20" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="skeleton h-5 w-40" />
          <div className="skeleton h-8 w-64 max-w-full" />
        </div>
        <div className="skeleton h-16 w-32 rounded-2xl" />
      </div>

      <div className="skeleton aspect-[16/9] w-full rounded-2xl" />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
            <div className="skeleton h-3 w-16" />
            <div className="skeleton mt-2 h-6 w-10" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="skeleton h-3.5 w-20" />
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
