"use client";

import { Pencil } from "lucide-react";
import type { Proposal } from "@/lib/proposal-mock";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand-mark";
import { useProfile } from "@/lib/auth-mock";

export function CoverSection({
  proposal,
  onChange,
  readOnly,
}: {
  proposal: Proposal;
  onChange: (next: Proposal) => void;
  readOnly?: boolean;
}) {
  const profile = useProfile();
  return (
    <section
      data-section="cover"
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card sm:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Badge>Proposal</Badge>
          {readOnly ? (
            <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
              New fence at <br className="hidden sm:block" />
              <span className="text-accent-700">{proposal.address || "—"}</span>
            </h1>
          ) : (
            <div className="mt-3">
              <div className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
                New fence at
              </div>
              <div className="group relative mt-1">
                <input
                  value={proposal.address}
                  onChange={(e) =>
                    onChange({ ...proposal, address: e.target.value })
                  }
                  placeholder="123 Main St, City, ST 00000"
                  aria-label="Property address"
                  className="w-[26rem] max-w-full rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-2xl font-semibold tracking-tight text-accent-700 outline-none transition-smooth placeholder:text-zinc-300 focus:border-accent-500 focus:bg-zinc-50/40 focus:ring-2 focus:ring-accent-500/15 sm:text-3xl"
                />
                <Pencil className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 opacity-0 transition-smooth group-focus-within:opacity-100 group-hover:opacity-100" />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/40 p-4 text-sm">
          <BrandMark
            initials={profile.logo.initials || "GU"}
            tone={profile.logo.tone}
            logoUrl={profile.logo.url}
            size="lg"
          />
          <div className="text-right">
            <div className="font-label text-[10px] text-zinc-500">
              Prepared by
            </div>
            <div className="mt-0.5 font-semibold text-zinc-900">
              {profile.company}
            </div>
            <div className="text-xs text-zinc-600">
              {profile.contractorName}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              License {profile.license}
            </div>
          </div>
        </div>
      </div>

      <EditableTextarea
        value={proposal.intro}
        onChange={(v) => onChange({ ...proposal, intro: v })}
        readOnly={readOnly}
        className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-700"
      />
    </section>
  );
}

function EditableTextarea({
  value,
  onChange,
  readOnly,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  className?: string;
}) {
  if (readOnly) {
    return <p className={className}>{value}</p>;
  }
  return (
    <div className="group relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={`${className} w-full resize-none rounded-lg border border-transparent bg-transparent p-2 outline-none transition-smooth group-hover:border-zinc-200 focus:border-accent-500 focus:bg-zinc-50/40 focus:ring-2 focus:ring-accent-500/15`}
      />
      <Pencil className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 text-zinc-400 opacity-0 transition-smooth group-focus-within:opacity-100 group-hover:opacity-100" />
    </div>
  );
}
