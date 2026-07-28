/**
 * Route-level skeleton for /dashboard pages that render on the server
 * (leads, support). Client pages manage their own skeletons; this
 * stops the dead-blank pause on the async ones.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6">
      <header>
        <div className="skeleton h-8 w-56 rounded-lg" />
        <div className="skeleton mt-2 h-4 w-80 max-w-full rounded-md" />
      </header>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-40 rounded-2xl" />
        ))}
      </section>
      <div className="skeleton h-72 rounded-2xl" />
    </div>
  );
}
