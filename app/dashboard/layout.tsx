import { redirect } from "next/navigation";
import { getMe } from "@/app/actions/me";

/**
 * One choke point for every /dashboard/* route: crew accounts belong in
 * the worker portal. Their userId owns no proposals, so the owner
 * console was already tenancy-safe for them — it just rendered as a
 * confusing wall of empty states. Owners and admins pass through;
 * signed-out users are handled by the pages/Clerk as before.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getMe();
  if (me?.user.role === "WORKER") redirect("/worker");
  return <>{children}</>;
}
