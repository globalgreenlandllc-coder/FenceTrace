"use client";

import { useMemo, useState, useTransition } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  CreditCard,
  Database,
  Eye,
  ExternalLink,
  Key,
  Lock,
  Loader2,
  Mail,
  Map as MapIcon,
  Plug,
  RefreshCw,
  Send,
  ShieldOff,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { ApiKeyProvider } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createApiKey,
  revealApiKey,
  revokeApiKey,
  rotateApiKey,
  sendTestEmail,
  testApiKey,
  type ApiKeyAuditEntry,
  type ApiKeyRow,
  type SendTestEmailResult,
  type TestApiKeyResult,
} from "@/app/actions/api-keys";
import { ALL_PROVIDERS } from "@/lib/api-key-providers";

const PROVIDER_META: Record<
  ApiKeyProvider,
  { label: string; sub: string; tone: Parameters<typeof Badge>[0]["tone"] }
> = {
  GOOGLE_MAPS: {
    label: "Google Maps",
    sub: "Geocoding · satellite · elevation (terrain)",
    tone: "sky",
  },
  REGRID: {
    label: "Regrid",
    sub: "Parcel boundaries (property lines)",
    tone: "emerald",
  },
  GOOGLE_SOLAR: {
    label: "Google Solar / Aerial",
    sub: "High-res aerial imagery + property detail",
    tone: "sky",
  },
  MAPBOX: {
    label: "Mapbox",
    sub: "Primary satellite tiles (Maxar Vivid) — sharper than Google in suburbs",
    tone: "sky",
  },
  OPENAI: {
    label: "OpenAI",
    sub: "GPT-4o vision for fence-line detection",
    tone: "violet",
  },
  FAL: {
    label: "fal.ai",
    sub: "SAM 2 property segmentation",
    tone: "violet",
  },
  NEARMAP: {
    label: "Nearmap AI",
    sub: "Eave / rake vector lines",
    tone: "amber",
  },
  EAGLEVIEW: {
    label: "EagleView",
    sub: "Premium property reports",
    tone: "amber",
  },
  RESEND: {
    label: "Resend",
    sub: "Transactional email (proposal delivery)",
    tone: "accent",
  },
  STRIPE_SECRET: {
    label: "Stripe (server)",
    sub: "Restricted server-side secret key",
    tone: "rose",
  },
  STRIPE_WEBHOOK: {
    label: "Stripe webhook",
    sub: "Signing secret (whsec_…) for /api/webhooks/stripe",
    tone: "rose",
  },
  SOCRATA: {
    label: "Socrata",
    sub: "App token for city open-data permit feeds (rate-limit bump)",
    tone: "accent",
  },
  ANTHROPIC: {
    label: "Anthropic (Claude)",
    sub: "Claude vision for reading construction plans → fence plan takeoff",
    tone: "violet",
  },
  GEMINI: {
    label: "Google Gemini",
    sub: "Second vision model for the uploaded-plan read (cross-checks Claude)",
    tone: "violet",
  },
};

// Where an admin goes to top up the provider's own account balance —
// distinct from ADD_KEY_HINTS (which is about grabbing a credential).
// Rendered as a persistent "Billing" link on any configured key, and
// promoted to a call-to-action when a Test comes back quota_exceeded.
const PROVIDER_BILLING_URL: Partial<Record<ApiKeyProvider, string>> = {
  OPENAI: "https://platform.openai.com/settings/organization/billing/overview",
  ANTHROPIC: "https://console.anthropic.com/settings/billing",
  FAL: "https://fal.ai/dashboard/billing",
  GEMINI: "https://console.cloud.google.com/billing",
  GOOGLE_MAPS: "https://console.cloud.google.com/billing",
  REGRID: "https://app.regrid.com/plans",
  GOOGLE_SOLAR: "https://console.cloud.google.com/billing",
  MAPBOX: "https://account.mapbox.com/billing/",
  RESEND: "https://resend.com/settings/billing",
};

const CATEGORIES: {
  key: string;
  label: string;
  icon: typeof MapIcon;
  providers: ApiKeyProvider[];
}[] = [
  {
    key: "mapping",
    label: "Mapping & imagery",
    icon: MapIcon,
    providers: ["GOOGLE_MAPS", "GOOGLE_SOLAR", "MAPBOX", "NEARMAP", "EAGLEVIEW"],
  },
  {
    key: "ai",
    label: "AI vision & inference",
    icon: Bot,
    providers: ["OPENAI", "ANTHROPIC", "GEMINI", "FAL"],
  },
  {
    key: "comms",
    label: "Communications",
    icon: Mail,
    providers: ["RESEND"],
  },
  {
    key: "payments",
    label: "Payments",
    icon: CreditCard,
    providers: ["STRIPE_SECRET", "STRIPE_WEBHOOK"],
  },
  {
    key: "data",
    label: "Public data",
    icon: Database,
    providers: ["SOCRATA"],
  },
];

// Per-provider hint that renders inside the Add Key dialog. Tells the
// admin where to actually grab the credential from + what format to
// expect. Skips the user-friendly back-and-forth where the admin
// pastes an email or the wrong provider's key by mistake.
const ADD_KEY_HINTS: Partial<Record<ApiKeyProvider, string>> = {
  RESEND:
    "resend.com → API Keys → Create API Key (with 'Sending access'). Key starts with 're_' and is ~40 characters. NOT an email address.",
  OPENAI:
    "platform.openai.com → API keys → Create new secret key. Starts with 'sk-'.",
  ANTHROPIC:
    "console.anthropic.com → API Keys → Create Key. Starts with 'sk-ant-'.",
  GEMINI:
    "aistudio.google.com → Get API key → Create API key. Starts with 'AIza'. Free tier available.",
  GOOGLE_MAPS:
    "console.cloud.google.com → APIs & Services → Credentials → API Key. Starts with 'AIza'.",
  GOOGLE_SOLAR:
    "console.cloud.google.com → APIs & Services → Credentials. Same shape as Maps but enable the Solar API.",
  MAPBOX:
    "account.mapbox.com → Tokens → 'Default public token' (starts with 'pk.…').",
  FAL: "fal.ai → Dashboard → Keys. Starts with the key ID followed by a colon, like 'KEY_ID:KEY_SECRET'.",
  STRIPE_SECRET:
    "dashboard.stripe.com → Developers → API keys → Secret key. Starts with 'sk_live_…' or 'sk_test_…'.",
  STRIPE_WEBHOOK:
    "dashboard.stripe.com → Developers → Webhooks → endpoint → Signing secret. Starts with 'whsec_'.",
  SOCRATA:
    "data city's Socrata portal → developer settings → App Token. ~20 character mixed-case string.",
  NEARMAP:
    "nearmap.com customer portal → API access → API Key (UUID-style).",
  EAGLEVIEW:
    "eagleview.com partner portal → API credentials.",
};

const ADD_KEY_PLACEHOLDERS: Partial<Record<ApiKeyProvider, string>> = {
  RESEND: "re_…",
  OPENAI: "sk-…",
  ANTHROPIC: "sk-ant-…",
  GEMINI: "AIza…",
  GOOGLE_MAPS: "AIza…",
  REGRID: "regrid API token",
  GOOGLE_SOLAR: "AIza…",
  MAPBOX: "pk.…",
  STRIPE_SECRET: "sk_live_… or sk_test_…",
  STRIPE_WEBHOOK: "whsec_…",
};

type Phase =
  | { kind: "idle" }
  | { kind: "add"; provider: ApiKeyProvider }
  | { kind: "rotate"; row: ApiKeyRow }
  | { kind: "reveal"; row: ApiKeyRow };

export function ApiKeysPage({
  rows: initial,
  audit: initialAudit,
}: {
  rows: ApiKeyRow[];
  audit: ApiKeyAuditEntry[];
}) {
  const [rows, setRows] = useState(initial);
  const [audit, setAudit] = useState(initialAudit);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const byProvider = useMemo(() => {
    const m = new Map<ApiKeyProvider, ApiKeyRow[]>();
    for (const p of ALL_PROVIDERS) m.set(p, []);
    for (const r of rows) {
      if (!m.has(r.provider)) m.set(r.provider, []);
      m.get(r.provider)!.push(r);
    }
    return m;
  }, [rows]);

  const configuredCount = ALL_PROVIDERS.filter(
    (p) => byProvider.get(p)?.some((r) => r.active),
  ).length;

  function handleSaved() {
    setPhase({ kind: "idle" });
    refetch();
  }

  async function refetch() {
    const { listApiKeys, listApiKeyAudit } = await import(
      "@/app/actions/api-keys"
    );
    const [r, a] = await Promise.all([listApiKeys(), listApiKeyAudit()]);
    setRows(r);
    setAudit(a);
  }

  return (
    <>
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
              API key vault
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">
              Encrypted-at-rest storage for the credentials that power the
              platform. Rotate without redeploying.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={configuredCount === ALL_PROVIDERS.length ? "emerald" : "amber"}>
              <Lock className="h-3 w-3" />
              {configuredCount} of {ALL_PROVIDERS.length} configured
            </Badge>
          </div>
        </header>

        {CATEGORIES.map((cat) => {
          const configuredInCat = cat.providers.filter((p) =>
            byProvider.get(p)?.some((r) => r.active),
          ).length;
          const CatIcon = cat.icon;
          return (
            <section key={cat.key} className="space-y-3">
              <div className="flex items-center gap-2 px-0.5">
                <CatIcon className="h-4 w-4 text-zinc-400" />
                <h2 className="font-label text-xs text-zinc-500">
                  {cat.label}
                </h2>
                <span className="text-xs text-zinc-300">·</span>
                <span className="text-xs text-zinc-400">
                  {configuredInCat}/{cat.providers.length}
                </span>
                <div className="h-px flex-1 bg-zinc-100" />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {cat.providers.map((provider) => {
                  const meta = PROVIDER_META[provider];
                  const list = byProvider.get(provider) ?? [];
                  const active = list.find((r) => r.active);
                  const inactive = list.filter((r) => !r.active);
                  return (
                    <ProviderCard
                      key={provider}
                      provider={provider}
                      label={meta.label}
                      sub={meta.sub}
                      tone={meta.tone}
                      billingUrl={PROVIDER_BILLING_URL[provider]}
                      active={active}
                      inactive={inactive}
                      onAdd={() => setPhase({ kind: "add", provider })}
                      onRotate={(row) => setPhase({ kind: "rotate", row })}
                      onReveal={(row) => setPhase({ kind: "reveal", row })}
                      onTest={(row) => testApiKey(row.id)}
                      onRevoke={async (row) => {
                        if (
                          !window.confirm(
                            `Revoke ${meta.label} key (…${row.fingerprint.slice(-4)})? Apps using it will start failing immediately.`,
                          )
                        ) {
                          return;
                        }
                        await revokeApiKey(row.id);
                        await refetch();
                      }}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}

        <section className="surface p-5 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900">
              Vault audit log
            </h2>
            <span className="text-xs text-zinc-500">
              Last {audit.length} events
            </span>
          </div>
          {audit.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
              No vault activity yet. Every create / reveal / rotate / revoke
              lands here with the actor and fingerprint.
            </div>
          ) : (
            <ul className="mt-4 space-y-1.5">
              {audit.map((e) => (
                <li
                  key={e.id}
                  className="rounded-lg border border-zinc-100 bg-zinc-50/40 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionBadge action={e.action} />
                    <span className="text-zinc-700">
                      {String(e.payload.provider ?? "")}
                    </span>
                    <span className="text-zinc-400">·</span>
                    <span className="font-mono text-xs text-zinc-500">
                      …
                      {String(
                        e.payload.fingerprint ??
                          e.payload.newFingerprint ??
                          "",
                      ).slice(-6)}
                    </span>
                    <span className="ml-auto text-xs text-zinc-500">
                      {new Date(e.at).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    by {e.actorEmail}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <AddDialog
        open={phase.kind === "add"}
        provider={phase.kind === "add" ? phase.provider : undefined}
        onClose={() => setPhase({ kind: "idle" })}
        onSaved={handleSaved}
      />

      <RotateDialog
        open={phase.kind === "rotate"}
        row={phase.kind === "rotate" ? phase.row : undefined}
        onClose={() => setPhase({ kind: "idle" })}
        onSaved={handleSaved}
      />

      <RevealDialog
        open={phase.kind === "reveal"}
        row={phase.kind === "reveal" ? phase.row : undefined}
        onClose={() => setPhase({ kind: "idle" })}
      />
    </>
  );
}

function ProviderCard({
  provider,
  label,
  sub,
  tone,
  billingUrl,
  active,
  inactive,
  onAdd,
  onRotate,
  onReveal,
  onRevoke,
  onTest,
}: {
  provider: ApiKeyProvider;
  label: string;
  sub: string;
  tone: Parameters<typeof Badge>[0]["tone"];
  /** Where to add funds to the provider's own account, if known. */
  billingUrl?: string;
  active: ApiKeyRow | undefined;
  inactive: ApiKeyRow[];
  onAdd: () => void;
  onRotate: (row: ApiKeyRow) => void;
  onReveal: (row: ApiKeyRow) => void;
  onRevoke: (row: ApiKeyRow) => void | Promise<void>;
  /** Hits a provider endpoint to validate the stored key and, for the
   *  paid providers, run one minimal real request so "out of credits"
   *  is detected instead of guessed. */
  onTest?: (row: ApiKeyRow) => Promise<TestApiKeyResult>;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestApiKeyResult | null>(null);
  // 'Send test email' state — only used on the Resend card.
  const [testEmailOpen, setTestEmailOpen] = useState(false);
  const [testEmailAddr, setTestEmailAddr] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [sendTestResult, setSendTestResult] =
    useState<SendTestEmailResult | null>(null);
  return (
    <div
      className={cn(
        "transition-smooth flex flex-col rounded-xl border bg-white p-5 shadow-card",
        active ? "border-zinc-200" : "border-dashed border-zinc-300",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone={tone}>
              <Key className="h-3 w-3" />
              {label}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{sub}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {active ? (
            <Badge tone="emerald">
              <Check className="h-3 w-3" />
              Active
            </Badge>
          ) : (
            <Badge tone="amber">Missing</Badge>
          )}
          {testResult?.reason === "quota_exceeded" && (
            <Badge tone="rose">
              <CreditCard className="h-3 w-3" />
              Out of credits
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-4 flex-1">
        {active ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="font-label text-[10px] text-zinc-400">
              Fingerprint
            </div>
            <div className="mt-0.5 font-mono text-sm text-zinc-900">
              ···{active.fingerprint.slice(-8)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              <span>{active.label}</span>
              <span>·</span>
              <span>
                Added{" "}
                {new Date(active.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              {active.lastUsedAt && (
                <>
                  <span>·</span>
                  <span>
                    Last used{" "}
                    {new Date(active.lastUsedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-500">
            Not configured. The provider call will fail until a key is added.
          </div>
        )}
      </div>

      {active && testResult && testResult.reason === "quota_exceeded" && (
        <div className="anim-enter-fade mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <div className="flex items-start gap-1.5">
            <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">{testResult.status}</div>
              {testResult.error && (
                <div className="mt-0.5 break-words font-mono text-[10px] opacity-80">
                  {testResult.error}
                </div>
              )}
            </div>
          </div>
          {billingUrl && (
            <a
              href={billingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-smooth ring-focus mt-2 inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
            >
              <ExternalLink className="h-3 w-3" />
              Add credits
            </a>
          )}
        </div>
      )}

      {active && testResult && testResult.reason !== "quota_exceeded" && (
        <div
          className={cn(
            "anim-enter-fade mt-3 rounded-lg border px-3 py-2 text-xs",
            testResult.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800",
          )}
        >
          <div className="flex items-start gap-1.5">
            {testResult.ok ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="font-medium">{testResult.status}</div>
              {testResult.error && (
                <div className="mt-0.5 break-words font-mono text-[10px] opacity-80">
                  {testResult.error}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resend-only: Send a test email so the admin can verify
          deliverability end-to-end (key valid, sender domain OK,
          recipient inbox gets the message) without going through the
          proposal flow. Inline panel rather than a modal so the result
          stays attached to the card it belongs to. */}
      {active && provider === "RESEND" && (
        <div className="mt-3 space-y-2">
          {sendTestResult && (
            <div
              className={cn(
                "anim-enter-fade rounded-lg border px-3 py-2 text-xs",
                sendTestResult.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800",
              )}
            >
              <div className="flex items-start gap-1.5">
                {sendTestResult.ok ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="font-medium">{sendTestResult.detail}</div>
                  {sendTestResult.from && (
                    <div className="mt-0.5 text-[10px] opacity-80">
                      From {sendTestResult.from} → {sendTestResult.to}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {testEmailOpen && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!testEmailAddr.trim()) return;
                setSendingTest(true);
                setSendTestResult(null);
                try {
                  const r = await sendTestEmail({ to: testEmailAddr.trim() });
                  setSendTestResult(r);
                  if (r.ok) {
                    setTestEmailOpen(false);
                  }
                } finally {
                  setSendingTest(false);
                }
              }}
              className="flex items-center gap-2"
            >
              <input
                type="email"
                required
                autoFocus
                value={testEmailAddr}
                onChange={(e) => setTestEmailAddr(e.target.value)}
                placeholder="you@example.com"
                className="transition-smooth h-8 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
              />
              <Button
                size="sm"
                disabled={sendingTest || !testEmailAddr.trim()}
                type="submit"
              >
                {sendingTest ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Send
              </Button>
              <button
                type="button"
                onClick={() => {
                  setTestEmailOpen(false);
                  setSendTestResult(null);
                }}
                className="transition-smooth ring-focus rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {active ? (
          <>
            {onTest && (
              <Button
                variant="outline"
                size="sm"
                disabled={testing}
                onClick={async () => {
                  setTesting(true);
                  setTestResult(null);
                  try {
                    const r = await onTest(active);
                    setTestResult(r);
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plug className="h-3.5 w-3.5" />
                )}
                Test
              </Button>
            )}
            {provider === "RESEND" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTestEmailOpen((v) => !v);
                  setSendTestResult(null);
                }}
              >
                <Mail className="h-3.5 w-3.5" />
                {testEmailOpen ? "Hide test email" : "Send test email"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReveal(active)}
            >
              <Eye className="h-3.5 w-3.5" />
              Reveal
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRotate(active)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Rotate
            </Button>
            {billingUrl && (
              <a
                href={billingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-smooth ring-focus inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                title={`Manage ${label} billing / add credits`}
              >
                <ExternalLink className="h-3 w-3" />
                Billing
              </a>
            )}
            <button
              onClick={() => onRevoke(active)}
              className="transition-smooth ring-focus ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
            >
              <ShieldOff className="h-3 w-3" />
              Revoke
            </button>
          </>
        ) : (
          <Button size="sm" onClick={onAdd}>
            <Zap className="h-3.5 w-3.5" />
            Add key
          </Button>
        )}
      </div>

      {inactive.length > 0 && (
        <div className="mt-4 border-t border-zinc-100 pt-3">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="transition-smooth ring-focus flex w-full items-center justify-between rounded-md text-xs text-zinc-500 hover:text-zinc-900"
          >
            <span>{inactive.length} prior {inactive.length === 1 ? "key" : "keys"}</span>
            <span className="text-[10px] uppercase tracking-wider">
              {showHistory ? "Hide" : "Show"}
            </span>
          </button>
          {showHistory && (
            <ul className="anim-enter-fade mt-2 space-y-1">
              {inactive.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-zinc-100 bg-zinc-50/30 px-2 py-1.5 text-xs"
                >
                  <span className="font-mono text-zinc-500">
                    ···{r.fingerprint.slice(-8)}
                  </span>
                  <span className="text-zinc-400">
                    {r.rotatedAt
                      ? `rotated ${new Date(r.rotatedAt).toLocaleDateString()}`
                      : "inactive"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<
    string,
    { label: string; tone: Parameters<typeof Badge>[0]["tone"] }
  > = {
    API_KEY_CREATED: { label: "Created", tone: "emerald" },
    API_KEY_ROTATED: { label: "Rotated", tone: "sky" },
    API_KEY_REVOKED: { label: "Revoked", tone: "rose" },
    API_KEY_VIEWED: { label: "Viewed", tone: "violet" },
  };
  const meta = map[action] ?? { label: action, tone: "neutral" as const };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function AddDialog({
  open,
  provider,
  onClose,
  onSaved,
}: {
  open: boolean;
  provider?: ApiKeyProvider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!provider || !value.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await createApiKey({
          provider,
          label: label.trim() || `${provider} key`,
          value,
        });
        if (!result.ok) {
          setError(result.reason);
          return;
        }
        setLabel("");
        setValue("");
        onSaved();
      } catch (e) {
        // Defense in depth — createApiKey now returns {ok, reason}
        // but if anything goes sideways post-deploy, surface it.
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <Dialog
      open={open && !!provider}
      onClose={onClose}
      title={provider ? `Add ${PROVIDER_META[provider].label} key` : "Add key"}
    >
      {provider && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            Encrypted with AES-256-GCM before storage. The plaintext value is
            never written to logs or git.
          </p>

          {/* Provider-specific guidance — admins routinely paste the
              wrong thing here (Gmail address, OpenAI key into Resend
              slot, etc.). The hint links to the right source. */}
          {(() => {
            const hint = ADD_KEY_HINTS[provider];
            if (!hint) return null;
            return (
              <div className="rounded-lg border border-accent-200 bg-accent-50/60 px-3 py-2 text-xs text-accent-900">
                <strong className="font-semibold">Where to get this:</strong>{" "}
                {hint}
              </div>
            );
          })()}

          <Field
            label="Label"
            value={label}
            onChange={setLabel}
            placeholder={`${PROVIDER_META[provider].label} production`}
          />
          <Field
            label="Key value"
            value={value}
            onChange={setValue}
            placeholder={
              ADD_KEY_PLACEHOLDERS[provider] ?? "sk_live_… / pk_live_… / AIza…"
            }
            mono
            type="password"
            autoFocus
          />

          {error && (
            <div className="anim-enter-fade rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={pending || !value.trim()}>
              {pending ? "Encrypting…" : "Save key"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function RotateDialog({
  open,
  row,
  onClose,
  onSaved,
}: {
  open: boolean;
  row?: ApiKeyRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!row || !value.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await rotateApiKey({ id: row.id, newValue: value });
        setValue("");
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Rotate failed");
      }
    });
  }

  return (
    <Dialog
      open={open && !!row}
      onClose={onClose}
      title={
        row ? `Rotate ${PROVIDER_META[row.provider].label} key` : "Rotate key"
      }
    >
      {row && (
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
            Current: <span className="font-mono">···{row.fingerprint.slice(-8)}</span>
            <span className="ml-2 text-zinc-400">
              · added {new Date(row.createdAt).toLocaleDateString()}
            </span>
          </div>
          <p className="text-sm text-zinc-600">
            Save the new value first. The current key is marked inactive
            immediately — there's no overlap window, so do this when traffic
            allows for a brief failure window per provider.
          </p>

          <Field
            label="New key value"
            value={value}
            onChange={setValue}
            placeholder="Paste the new key"
            mono
            type="password"
            autoFocus
          />

          {error && (
            <div className="anim-enter-fade rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={pending || !value.trim()}>
              {pending ? "Rotating…" : "Rotate now"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function RevealDialog({
  open,
  row,
  onClose,
}: {
  open: boolean;
  row?: ApiKeyRow;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  function reveal() {
    if (!row) return;
    startTransition(async () => {
      const r = await revealApiKey(row.id);
      setRevealed(r.value);
    });
  }

  function copy() {
    if (!revealed) return;
    navigator.clipboard.writeText(revealed).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function close() {
    setRevealed(null);
    setCopied(false);
    onClose();
  }

  return (
    <Dialog
      open={open && !!row}
      onClose={close}
      title={row ? `Reveal ${PROVIDER_META[row.provider].label}` : "Reveal"}
    >
      {row && (
        <div className="space-y-4">
          {!revealed ? (
            <>
              <p className="text-sm text-zinc-600">
                This will decrypt the value and log a{" "}
                <span className="font-medium">VIEWED</span> event with your
                identity, the timestamp, and the fingerprint.
              </p>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                Fingerprint:{" "}
                <span className="font-mono">···{row.fingerprint.slice(-8)}</span>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={close}>
                  Cancel
                </Button>
                <Button size="sm" onClick={reveal} disabled={pending}>
                  {pending ? "Decrypting…" : "Reveal & log"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-zinc-500">
                Don't share this value. The reveal was logged at{" "}
                {new Date().toLocaleTimeString()}.
              </p>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="font-label text-[10px] text-zinc-400">
                  Plaintext value
                </div>
                <pre className="mt-1 break-all font-mono text-sm text-zinc-900">
                  {revealed}
                </pre>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copy}
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </Button>
                <Button size="sm" onClick={close}>
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-label mb-1.5 block text-[11px] text-zinc-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn("input h-11", mono && "font-mono")}
      />
    </label>
  );
}

function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-sm" />
          <motion.div
            initial={reduce ? false : { scale: 0.95, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-elevated"
          >
            <button
              onClick={onClose}
              className="transition-smooth ring-focus absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
              {title}
            </h2>
            <div className="mt-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
