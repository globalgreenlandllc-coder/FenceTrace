"use client";

import { Suspense } from "react";
import { AuthGate } from "@/components/auth/auth-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { ClientsCrm } from "@/components/dashboard/clients-crm";

export default function ClientsPage() {
  return (
    <AuthGate>
      <DashboardShell
        title="Clients"
        eyebrow="CRM"
        subtitle="Every homeowner you've quoted, ranked by who needs a touch today."
      >
        <Suspense fallback={null}>
          <ClientsCrm />
        </Suspense>
      </DashboardShell>
    </AuthGate>
  );
}
