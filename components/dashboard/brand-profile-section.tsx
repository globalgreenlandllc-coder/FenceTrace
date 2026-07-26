"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Building2,
  Check,
  Eye,
  Image as ImageIcon,
  Pencil,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { DUR, EASE } from "@/lib/motion";
import {
  defaultProfile,
  useUpdateProfile,
  useProfile,
  type ContractorProfile,
  type LogoTone,
} from "@/lib/auth-mock";
import { cn } from "@/lib/utils";

const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_LOGO_BYTES = 450 * 1024;

const TONES: { id: LogoTone; label: string; swatch: string }[] = [
  { id: "emerald", label: "Emerald", swatch: "bg-accent-500" },
  { id: "sky", label: "Sky", swatch: "bg-sky-500" },
  { id: "indigo", label: "Indigo", swatch: "bg-indigo-500" },
  { id: "violet", label: "Violet", swatch: "bg-violet-500" },
  { id: "amber", label: "Amber", swatch: "bg-amber-500" },
  { id: "rose", label: "Rose", swatch: "bg-rose-500" },
  { id: "zinc", label: "Slate", swatch: "bg-zinc-700" },
];

export function BrandProfileSection() {
  const stored = useProfile();
  const updateProfile = useUpdateProfile();
  const [draft, setDraft] = useState<ContractorProfile>(stored);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(stored);
  }, [
    stored.company,
    stored.contractorName,
    stored.email,
    stored.phone,
    stored.license,
    stored.tagline,
    stored.logo.initials,
    stored.logo.tone,
    stored.logo.url,
  ]);

  async function handleFile(file: File | null) {
    setUploadError(null);
    if (!file) return;
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setUploadError(
        "Use PNG, JPEG, WebP, or SVG. Other formats aren't supported.",
      );
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setUploadError(
        `That file is ${Math.round(file.size / 1024)} KB. Max is 450 KB — try a smaller one or a tighter crop.`,
      );
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setLogo("url", dataUrl);
  }

  function removeLogo() {
    setLogo("url", null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  function update<K extends keyof ContractorProfile>(
    key: K,
    value: ContractorProfile[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setLogo<K extends keyof ContractorProfile["logo"]>(
    key: K,
    value: ContractorProfile["logo"][K],
  ) {
    setDraft((d) => ({ ...d, logo: { ...d.logo, [key]: value } }));
  }

  async function save() {
    setSaving(true);
    try {
      await updateProfile(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    const def = defaultProfile();
    setDraft(def);
    setSaving(true);
    try {
      await updateProfile(def);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="anim-enter surface p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-label flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Building2 className="h-3.5 w-3.5" />
            Brand
          </div>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">
            Brand & company profile
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Shown on every proposal cover and the homeowner portal.
          </p>
        </div>
        <Badge tone={dirty ? "amber" : "emerald"}>
          {dirty ? "Unsaved changes" : (
            <>
              <Check className="h-3 w-3" />
              Saved
            </>
          )}
        </Badge>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Company name"
              value={draft.company}
              onChange={(v) => update("company", v)}
            />
            <Field
              label="Contractor name"
              value={draft.contractorName}
              onChange={(v) => update("contractorName", v)}
            />
            <Field
              label="Phone"
              value={draft.phone}
              onChange={(v) => update("phone", v)}
            />
            <Field
              label="Email"
              type="email"
              value={draft.email}
              onChange={(v) => update("email", v)}
            />
            <Field
              label="License #"
              value={draft.license}
              onChange={(v) => update("license", v)}
            />
            <Field
              label="Logo monogram"
              value={draft.logo.initials}
              onChange={(v) =>
                setLogo("initials", v.slice(0, 3).toUpperCase())
              }
              hint="1–3 letters"
            />
          </div>

          <div>
            <label className="font-label mb-1.5 block text-[10px] text-zinc-400">
              Tagline
            </label>
            <textarea
              value={draft.tagline}
              onChange={(e) => update("tagline", e.target.value)}
              rows={2}
              maxLength={120}
              className="transition-smooth w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
            />
            <div className="mt-1 text-right text-[11px] text-zinc-400">
              {draft.tagline.length}/120
            </div>
          </div>

          <div>
            <label className="font-label mb-2 block text-[10px] text-zinc-400">
              Logo image
            </label>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50/40 p-3">
              <BrandMark
                initials={draft.logo.initials || "GU"}
                tone={draft.logo.tone}
                logoUrl={draft.logo.url}
                size="lg"
                rounded="xl"
              />
              <div className="flex-1 text-xs text-zinc-500">
                {draft.logo.url ? (
                  <span>Custom image active. Replace or remove below.</span>
                ) : (
                  <span>
                    Optional. Upload a square PNG, JPEG, WebP, or SVG. Max
                    450&nbsp;KB. Without an image, the colored monogram is
                    used.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_LOGO_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {draft.logo.url ? "Replace" : "Upload"}
                </Button>
                {draft.logo.url && (
                  <button
                    type="button"
                    onClick={removeLogo}
                    className="transition-smooth ring-focus press-scale inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:border-rose-300 hover:text-rose-600"
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </button>
                )}
              </div>
            </div>
            {uploadError && (
              <div className="anim-enter-fade mt-2 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <ImageIcon className="h-3.5 w-3.5" />
                {uploadError}
              </div>
            )}
          </div>

          <div>
            <label className="font-label mb-2 block text-[10px] text-zinc-400">
              Logo color (used when no image is set)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((t) => {
                const selected = draft.logo.tone === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setLogo("tone", t.id)}
                    className={cn(
                      "transition-smooth ring-focus press-scale flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs",
                      selected
                        ? "border-zinc-300 bg-zinc-50 text-zinc-900"
                        : "border-zinc-200 text-zinc-600 hover:border-zinc-300",
                    )}
                  >
                    <span className={cn("h-3.5 w-3.5 rounded-full", t.swatch)} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={!dirty || saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={saving}>
              Reset to defaults
            </Button>
          </div>
        </div>

        <ProposalPreview draft={draft} />
      </div>
    </section>
  );
}

function ProposalPreview({ draft }: { draft: ContractorProfile }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DUR.slow, ease: EASE }}
      className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/40 p-4"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-label text-[10px] text-zinc-400">
          Live preview
        </span>
        <span className="inline-flex items-center gap-1 text-zinc-500">
          <Eye className="h-3 w-3" />
          Proposal header
        </span>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <BrandMark
            initials={draft.logo.initials || "GU"}
            tone={draft.logo.tone}
            logoUrl={draft.logo.url}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-900">
              {draft.company || "Your company"}
            </div>
            <div className="truncate text-xs text-zinc-500">
              {draft.contractorName || "Contractor"} · License {draft.license || "—"}
            </div>
            <div className="mt-1 line-clamp-2 text-xs text-zinc-500">
              {draft.tagline}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
          <span>{draft.phone}</span>
          <span>·</span>
          <span className="truncate">{draft.email}</span>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-zinc-200 p-3 text-xs text-zinc-500">
        <div className="flex items-center gap-1.5">
          <Pencil className="h-3 w-3" />
          Changes flow into <span className="font-medium text-zinc-700">/proposal</span>{" "}
          and <span className="font-medium text-zinc-700">/p/[token]</span> immediately.
        </div>
      </div>
    </motion.div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="font-label mb-1.5 block text-[10px] text-zinc-400">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
      {hint && (
        <span className="mt-1 block text-[11px] text-zinc-400">{hint}</span>
      )}
    </label>
  );
}
