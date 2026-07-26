"use client";

import { AuthGate } from "@/components/auth/auth-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { WorkersView } from "@/components/workers/workers-view";

export default function WorkersPage() {
  return (
    <AuthGate>
      <DashboardShell title="Workers" contentClassName="max-w-[1200px]">
        <WorkersView />
      </DashboardShell>
    </AuthGate>
  );
}
