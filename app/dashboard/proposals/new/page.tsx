"use client";

import { AuthGate } from "@/components/auth/auth-gate";
import { DashboardShell } from "@/components/dashboard/dashboard-nav";
import { StartOptions } from "@/components/dashboard/start-options";

export default function NewProposalPage() {
  return (
    <AuthGate>
      <DashboardShell fullBleed={false}>
        {/* This page draws its own header (no shell title). */}
        <div className="anim-enter flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent-500" />
          New proposal
        </div>
        <h1 className="anim-enter stagger-1 mt-3 max-w-xl text-[36px] font-semibold leading-[1.04] tracking-tight text-zinc-900 sm:text-[44px]">
          How do you want to <span className="text-gradient">start?</span>
        </h1>
        <p className="anim-enter stagger-2 mt-3 max-w-lg text-[15px] leading-relaxed text-zinc-500">
          Every lane ends in the same place — a priced proposal ready to
          send. The AI lanes do the measuring for you.
        </p>

        <StartOptions />
      </DashboardShell>
    </AuthGate>
  );
}
