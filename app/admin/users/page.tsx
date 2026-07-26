import { listUsersForAdmin } from "@/app/actions/admin";
import { UsersTable } from "@/components/admin/users-table";

export default async function AdminUsersPage({
  searchParams,
}: {
  // A repeated key (?q=a&q=b) parses to string[] in the App Router — coerce
  // to a single string so it can't reach the client filter as an array.
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const [{ q }, rows] = await Promise.all([searchParams, listUsersForAdmin()]);
  const initialQuery = Array.isArray(q) ? (q[0] ?? "") : (q ?? "");

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Contractors
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Every account on the platform. Adjust credits, suspend, or shadow-login.
          </p>
        </div>
        <div className="text-sm text-zinc-500">
          Showing <span className="font-semibold text-zinc-900">{rows.length}</span>{" "}
          {rows.length === 1 ? "user" : "users"}
        </div>
      </header>

      {/* key on the seed so a soft nav that changes ?q (e.g. sidebar
          "Users" clearing it) remounts the table and re-seeds the box —
          otherwise the useState seed would leave a stale filter. */}
      <UsersTable key={initialQuery} rows={rows} initialQuery={initialQuery} />
    </div>
  );
}
