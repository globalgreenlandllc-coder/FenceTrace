"use client";

import { Suspense } from "react";
import { AuthGate } from "@/components/auth/auth-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { FinancialsClient } from "@/components/dashboard/financials-client";

export default function FinancialsPage() {
  return (
    <AuthGate>
      <DashboardShell
        title="Financials"
        eyebrow="Money"
        subtitle="Your overhead, what every job really costs, and the profit that's left."
      >
        <Suspense fallback={null}>
          <FinancialsClient />
        </Suspense>
      </DashboardShell>
    </AuthGate>
  );
}
