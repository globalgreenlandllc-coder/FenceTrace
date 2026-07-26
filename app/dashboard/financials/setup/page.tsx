"use client";

import { Suspense } from "react";
import { AuthGate } from "@/components/auth/auth-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { FinancialsSetupClient } from "@/components/dashboard/financials-setup-client";

export default function FinancialsSetupPage() {
  return (
    <AuthGate>
      <DashboardShell
        title="Overhead & profit planner"
        eyebrow="Money"
        subtitle="Your recurring bills, and how every revenue dollar splits between crew, sales, and you."
      >
        <Suspense fallback={null}>
          <FinancialsSetupClient />
        </Suspense>
      </DashboardShell>
    </AuthGate>
  );
}
