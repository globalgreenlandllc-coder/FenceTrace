"use client";

import { AuthGate } from "@/components/auth/auth-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { ManualMeasureForm } from "@/components/dashboard/manual-measure-form";

/**
 * Manual proposal — a self-contained flow, separate from the AI-takeoff
 * /proposal builder. For jobs with no plans and an address the
 * satellite scan can't resolve: the contractor measured the property on
 * site, types the numbers in, reviews the packages, and sends the
 * proposal right here.
 */
export default function ManualMeasurePage() {
  return (
    <AuthGate>
      <DashboardShell
        eyebrow="Manual proposal"
        title="Type in what you measured on site"
        subtitle="No plans? Address won't scan? Enter the fence runs off your tape measure — gates and end posts suggest themselves, every package prices live, and you send the finished proposal right from this page."
      >
        <ManualMeasureForm />
      </DashboardShell>
    </AuthGate>
  );
}
