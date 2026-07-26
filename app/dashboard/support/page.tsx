import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { getMyTickets } from "@/app/actions/support";
import { SupportCenter } from "@/components/dashboard/support-center";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const tickets = await getMyTickets();
  return (
    <DashboardShell
      title="Help & support"
      subtitle="Send us a message — we'll reply here and by email."
    >
      <div className="max-w-[760px]">
        <SupportCenter initial={tickets} />
      </div>
    </DashboardShell>
  );
}
