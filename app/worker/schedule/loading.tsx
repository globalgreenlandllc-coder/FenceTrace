/** Route skeleton for /worker/schedule — day header + agenda rows.
 *  Server component: shimmer comes from the .skeleton utility (CSS only). */
export default function WorkerScheduleLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="skeleton h-6 w-28" />
        <div className="skeleton h-4 w-64 max-w-full" />
      </div>

      <div className="space-y-6">
        {[2, 1].map((rows, g) => (
          <div key={g}>
            <div className="skeleton mb-2 h-4 w-40" />
            <div className="space-y-2">
              {Array.from({ length: rows }, (_, r) => (
                <div key={r} className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <div className="skeleton h-4 w-16 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="skeleton h-4 w-1/2" />
                    <div className="skeleton h-3 w-2/3" />
                  </div>
                  <div className="skeleton h-4 w-12" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
