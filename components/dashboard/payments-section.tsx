"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CreditCard,
  ExternalLink,
  Loader2,
  Plug,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProfile, useUpdateProfile } from "@/lib/auth-mock";
import {
  getInvoiceRailStatus,
  removeInvoiceRailKey,
  saveInvoiceRailKey,
  type InvoiceRailStatus,
} from "@/app/actions/provider-invoices";

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

        <InvoiceRails />
      </div>
    </section>
  );
}

/**
 * The invoicing keys — different from the payment links above (a link
 * is pasted on proposals; a key lets the app send real provider
 * invoices from YOUR account and hear when they're paid). Connect
 * whichever processor you use — Square, Stripe, or Stax — and every
 * unpaid installment gets an "Invoice" button, the client's portal a
 * live "Pay now", and acceptance auto-invoices the deposit.
 */
function InvoiceRails() {
  const [status, setStatus] = useState<InvoiceRailStatus | null>(null);

  useEffect(() => {
    let alive = true;
    void getInvoiceRailStatus().then((r) => {
      if (alive) setStatus(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!status) return null;

  return (
    <div className="border-t border-zinc-100 pt-5">
      <div className="font-label flex items-center gap-1.5 text-[11px] text-zinc-400">
        <Plug className="h-3.5 w-3.5" />
        Invoicing — send real Square / Stripe / Stax invoices
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        Connect the processor you already use. With a key connected, every
        unpaid installment in the payments drawer gets an &quot;Invoice&quot;
        button: the client receives the provider&apos;s own invoice email,
        pays on its hosted page (card or bank), and the payment is recorded
        here automatically — receipts, progress, and &quot;done job&quot;
        included. Money goes straight to your processor account.
      </p>
      <div className="mt-3 space-y-3">
        <RailRow
          provider="square"
          label="Square"
          connected={status.square.connected}
          hint="Square Developer dashboard → your app → Production → Access token"
          detail={
            status.square.connected
              ? "Card + bank transfer (ACH) on every invoice — the client picks at checkout."
              : null
          }
          onChanged={(v) =>
            setStatus((s) => (s ? { ...s, square: { connected: v } } : s))
          }
        />
        <RailRow
          provider="stripe"
          label="Stripe"
          connected={status.stripe.connected}
          hint="Stripe dashboard → Developers → API keys → Secret key (sk_live_…), or a restricted key with Invoices + Customers write"
          detail={
            status.stripe.connected
              ? "Clients pay on Stripe's hosted invoice page — card always, bank (ACH) when your Stripe account has it enabled."
              : null
          }
          onChanged={(v) =>
            setStatus((s) => (s ? { ...s, stripe: { connected: v } } : s))
          }
        />
        <RailRow
          provider="stax"
          label="Stax"
          connected={status.stax.connected}
          hint="Stax dashboard → Apps → API keys"
          detail={
            !status.stax.connected
              ? null
              : status.stax.ach === true
                ? `Card + bank transfer (ACH) enabled${
                    status.stax.achLimitCents != null
                      ? ` · ACH up to $${(status.stax.achLimitCents / 100).toLocaleString("en-US")} per payment`
                      : ""
                  }. Clients connect their bank on the pay page (Plaid-verified) — bigger amounts fall back to card.`
                : status.stax.ach === false
                  ? "Bank payments (ACH) are OFF on your Stax account — ask Stax support to enable ACH; clients then verify their bank through Plaid on the pay page. Card works meanwhile."
                  : "Card enabled · couldn't read the account's ACH setting right now."
          }
          onChanged={(v) =>
            setStatus((s) =>
              s ? { ...s, stax: { connected: v, ach: null, achLimitCents: null } } : s,
            )
          }
        />
      </div>
    </div>
  );
}

function RailRow({
  provider,
  label,
  connected,
  hint,
  detail,
  onChanged,
}: {
  provider: "square" | "stripe" | "stax";
  label: string;
  connected: boolean;
  hint: string;
  /** One line under the badge about what this rail can take — the ACH
   *  story lives here so the contractor never has to guess. */
  detail?: React.ReactNode;
  onChanged: (connected: boolean) => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const r = await saveInvoiceRailKey(provider, key);
    setBusy(false);
    if (!r.ok) return setErr(r.reason);
    setKey("");
    onChanged(true);
  }

  async function remove() {
    setBusy(true);
    setErr(null);
    const r = await removeInvoiceRailKey(provider);
    setBusy(false);
    if (!r.ok) return setErr(r.reason);
    onChanged(false);
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-zinc-900">{label}</span>
        {connected ? (
          <Badge tone="emerald">
            <Check className="h-3 w-3" /> Connected
          </Badge>
        ) : (
          <Badge tone="neutral">Not connected</Badge>
        )}
        {connected && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="ring-focus ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-zinc-400 transition-smooth hover:bg-rose-50 hover:text-rose-600"
          >
            <X className="h-3 w-3" /> Disconnect
          </button>
        )}
      </div>
      {detail && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          {detail}
        </p>
      )}
      {!connected && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={`Paste your ${label} API key`}
            className="input min-w-0 flex-1"
            autoComplete="off"
          />
          <Button onClick={() => void save()} disabled={busy || key.trim().length < 10}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            Connect
          </Button>
        </div>
      )}
      {!connected && (
        <p className="mt-1.5 text-[11px] text-zinc-500">
          {hint}. The key is checked live before it&apos;s stored (a
          read-only test — it can&apos;t move money), then encrypted.
        </p>
      )}
      {err && <p className="mt-1.5 text-[11px] text-rose-600">{err}</p>}
    </div>
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
