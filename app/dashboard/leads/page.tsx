import LeadsMap from "@/components/leads/LeadsMap";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { getActiveApiKey } from "@/lib/api-keys";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Leads Map - Smart Permit Tracker",
  description: "Find and track construction permits as actionable leads.",
};

export default async function LeadsPage() {
  const googleMapsKey = await getActiveApiKey("GOOGLE_MAPS");

  return (
    <DashboardShell title="Leads" fullBleed>
      <LeadsMap apiKey={googleMapsKey || "dummy_key"} />
    </DashboardShell>
  );
}
