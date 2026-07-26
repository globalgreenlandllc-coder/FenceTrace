"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CreditCard,
  ExternalLink,
  Save,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProfile, useUpdateProfile } from "@/lib/auth-mock";

export function PaymentsSection() {
  const stored = useProfile();
  const updateProfile = useUpdateProfile();
  const [stripeUrl, setStripeUrl] = useState(stored.payments.stripeUrl ?? "");
  const [squareUrl, setSquareUrl] = useState(stored.payments.squareUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStripeUrl(stored.payments.stripeUrl ?? "");
    setSquareUrl(stored.payments.squareUrl ?? "");
  }, [stored.payments.stripeUrl, stored.payments.squareUrl]);

  const dirty =
    (stripeUrl.trim() || null) !== (stored.payments.stripeUrl ?? null) ||
    (squareUrl.trim() || null) !== (stored.payments.squareUrl ?? null);

  const connectedCount =
    (stored.payments.stripeUrl ? 1 : 0) +
    (stored.payments.squareUrl ? 1 : 0);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({
        payments: {
          stripeUrl: stripeUrl.trim() ? stripeUrl.trim() : null,
          squareUrl: squareUrl.trim() ? squareUrl.trim() : null,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save payment links.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="anim-enter stagger-1 surface p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-label flex items-center gap-1.5 text-[11px] text-zinc-400">
            <CreditCard className="h-3.5 w-3.5" />
            Payments
          </div>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-900">
            Get paid — Stripe or Square
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Paste a payment link from Stripe or Square. Homeowners see it on
            accepted proposals and pay you directly.
          </p>
        </div>
        <Badge tone={connectedCount > 0 ? "emerald" : "amber"}>
          {connectedCount > 0 ? (
            <>
              <Check className="h-3 w-3" />
              {connectedCount === 2 ? "Both connected" : "1 connected"}
            </>
          ) : (
            "Not connected"
          )}
        </Badge>
      </div>

      <div className="mt-5 space-y-5">
        <UrlField
          label="Stripe Payment Link"
          placeholder="https://buy.stripe.com/abc123..."
          value={stripeUrl}
          onChange={setStripeUrl}
          help={
            <>
              Create one at{" "}
              <a
                href="https://dashboard.stripe.com/payment-links"
                target="_blank"
                rel="noreferrer noopener"
                className="ring-focus inline-flex items-center gap-0.5 rounded-sm text-accent-700 underline-offset-2 hover:underline"
              >
                dashboard.stripe.com/payment-links
                <ExternalLink className="h-3 w-3" />
              </a>
              . Funds go to your Stripe account directly — no platform fee.
            </>
          }
        />

        <UrlField
          label="Square checkout link"
          placeholder="https://square.link/u/..."
          value={squareUrl}
          onChange={setSquareUrl}
          help={
            <>
              Create one in Square Dashboard → Online → Checkout Links, or use{" "}
              <a
                href="https://squareup.com/dashboard/items/checkout-links"
                target="_blank"
                rel="noreferrer noopener"
                className="ring-focus inline-flex items-center gap-0.5 rounded-sm text-accent-700 underline-offset-2 hover:underline"
              >
                squareup.com
                <ExternalLink className="h-3 w-3" />
              </a>
              .
            </>
          }
        />

        {error && (
          <div className="anim-enter-fade rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={!dirty || saving}>
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : saved ? "Saved" : "Save payment links"}
          </Button>
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
            <ShieldCheck className="h-3.5 w-3.5 text-accent-600" />
            Links are validated (https only) and shown to clients on your
            accepted proposals, payment reminders and receipts.
          </span>
        </div>
      </div>
    </section>
  );
}

function UrlField({
  label,
  placeholder,
  value,
  onChange,
  help,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  help: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-label mb-1.5 block text-[10px] text-zinc-400">
        {label}
      </span>
      <input
        type="url"
        inputMode="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input"
      />
      <span className="mt-1.5 block text-[11px] leading-relaxed text-zinc-500">
        {help}
      </span>
    </label>
  );
}
