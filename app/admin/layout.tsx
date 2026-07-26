import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/admin";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireSuperAdmin();
  if (me.impersonation) {
    redirect("/dashboard");
  }
  return <AdminShell me={me}>{children}</AdminShell>;
}
