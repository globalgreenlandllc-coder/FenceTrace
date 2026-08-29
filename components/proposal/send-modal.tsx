"use client";

import { useEffect, useState, useTransition } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, Copy, Headphones, Loader2, Mail, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Proposal } from "@/lib/proposal-mock";
import { sendProposal } from "@/app/actions/proposals";
import { createSubscriptionCheckout } from "@/app/actions/billing";
import { listInvoiceProviders } from "@/app/actions/provider-invoices";
import { cn } from "@/lib/utils";

type Rail = "square" | "stripe" | "stax";

const RAIL_LABELS: Record<Rail, string> = {
  square: "Square",
  stripe: "Stripe",
  stax: "Stax",
};

function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function SendModal({
  open,
  onClose,
  proposal,
}: {
  open: boolean;
  onClose: () => void;
  proposal: Proposal;
}) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<"compose" | "sent">("compose");
  // Editable client info — seeded from the proposal but the contractor
  // can correct typos / fill in blanks right before sending. The send
  // action receives a merged proposal so these values stick.
  const [clientName, setClientName] = useState(proposal.client.name);
  const [clientEmail, setClientEmail] = useState(proposal.client.email);
  const [subject, setSubject] = useState(
    `Your fence proposal — ${proposal.address}`,
  );
  const firstName = (clientName.trim().split(/\s+/)[0] || "there").replace(
    /^there$/,
    "there",
  );
  const [message, setMessage] = useState(
    `Hi ${firstName},\n\nAttached is your fence proposal. Tap below to review the three options, sign, and pay your deposit. Pricing locked for ${proposal.validDays} days.\n\n— ${proposal.contractor.name}`,
  );
  // Track whether the user has hand-edited the message; if not, keep
  // the greeting auto-synced to the client-name field.
  const [messageDirty, setMessageDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  // Which rails have keys connected; the default is the first, so the
  // common case is already chosen when the modal opens.
  const [rails, setRails] = useState<Rail[]>([]);
  const [payWith, setPayWith] = useState<Rail | null>(null);
  useEffect(() => {
    if (!open) return;
    listInvoiceProviders()
      .then((r) => {
        setRails(r);
        setPayWith((cur) => cur ?? r[0] ?? null);
      })
      .catch(() => undefined);
  }, [open]);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sentPortalUrl, setSentPortalUrl] = useState<string | null>(null);
  // Whether the spoken summary finished building during the send.
  const [audioReady, setAudioReady] = useState(false);
  const portalUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/p/${proposal.token}`
      : `/p/${proposal.token}`;

  function onClientNameChange(v: string) {
    setClientName(v);
    if (!messageDirty) {
      const first = v.trim().split(/\s+/)[0] || "there";
      setMessage(
        `Hi ${first},\n\nAttached is your fence proposal. Tap below to review the three options, sign, and pay your deposit. Pricing locked for ${proposal.validDays} days.\n\n— ${proposal.contractor.name}`,
      );
    }
  }

  function copy() {
    navigator.clipboard?.writeText(portalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  async function upgrade(interval: "month" | "year" = "month") {
    setUpgrading(true);
    try {
      const res = await createSubscriptionCheckout(interval);
      if (res.ok) {
        window.location.href = res.url;
        return;
      }
      setError(res.reason);
    } catch {
      setError("Couldn't start checkout — try again from Settings → Billing.");
    }
    setUpgrading(false);
  }

  function send() {
    setError(null);
    setLimitHit(false);
    const trimmedName = clientName.trim();
    const trimmedEmail = clientEmail.trim();
    if (!trimmedName) {
      setError("Client name is required.");
      return;
    }
    if (!isPlausibleEmail(trimmedEmail)) {
      setError("Client email looks invalid (need name@domain.tld).");
      return;
    }
    // Send a proposal copy with the edited client info merged in so the
    // server persists the latest values + uses the new email/name in
    // the outgoing template.
    const updated: Proposal = {
      ...proposal,
      client: {
        ...proposal.client,
        name: trimmedName,
        email: trimmedEmail,
      },
    };
    startTransition(async () => {
      const res = await sendProposal({
        proposal: updated,
        subject,
        message,
        payWith,
      });
      if (res.ok) {
        setSentPortalUrl(res.portalUrl);
        setAudioReady(res.audioReady);
        setPhase("sent");
      } else if (res.code === "limit_reached") {
        // Peak intent: they just tried to send a real quote. Offer the
        // fix right here, not a trip through Settings.
        setLimitHit(true);
      } else {
        setError(res.reason);
      }
    });
  }

  function handleClose() {
    setPhase("compose");
    setError(null);
    setLimitHit(false);
    setSentPortalUrl(null);
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-ink/40" />
          <motion.div
            initial={reduce ? false : { scale: 0.95, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
            // max-h + scroll: on a phone with the keyboard up the compose
            // form is taller than the viewport, and without this the send
            // button ends up off-screen with no way to reach it.
            className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-xl border border-zinc-200 bg-white shadow-elevated"
          >
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="ring-focus active:scale-[0.98] absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-smooth hover:bg-zinc-100 hover:text-zinc-900"
            >
              <X className="h-4 w-4" />
            </button>

            {phase === "compose" ? (
              <div className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                      Send proposal
                    </h2>
                    <p className="text-xs text-zinc-500">
                      Delivered via Resend with a secure portal link.
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <Row label="Client">
                    <input
                      value={clientName}
                      onChange={(e) => onClientNameChange(e.target.value)}
                      placeholder="Full name"
                      className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                    />
                  </Row>
                  <Row label="Email">
                    <input
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      placeholder="name@domain.com"
                      type="email"
                      autoComplete="off"
                      className={cn(
                        "w-full bg-transparent text-sm outline-none placeholder:text-zinc-400",
                        clientEmail && !isPlausibleEmail(clientEmail)
                          ? "text-rose-700"
                          : "text-zinc-900",
                      )}
                    />
                  </Row>
                  <Row label="Subject">
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full bg-transparent text-sm text-zinc-900 outline-none"
                    />
                  </Row>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50/40 p-3">
                    <textarea
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value);
                        setMessageDirty(true);
                      }}
                      rows={6}
                      className="w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-700 outline-none"
                    />
                  </div>
                  <Row label="Portal link">
                    <div className="flex w-full items-center gap-2">
                      <span className="truncate text-xs text-zinc-600">
                        {portalUrl}
                      </span>
                      <button
                        type="button"
                        onClick={copy}
                        className={cn(
                          "ring-focus active:scale-[0.98] ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-smooth",
                          copied
                            ? "border-accent-200 bg-accent-50 text-accent-700"
                            : "border-zinc-200 text-zinc-700 hover:border-accent-400 hover:text-accent-700",
                        )}
                      >
                        {copied ? (
                          <span
                            key="copied"
                            className="anim-enter-fade inline-flex items-center gap-1"
                          >
                            <Check className="h-3 w-3" /> Copied
                          </span>
                        ) : (
                          <span
                            key="copy"
                            className="anim-enter-fade inline-flex items-center gap-1"
                          >
                            <Copy className="h-3 w-3" /> Copy
                          </span>
                        )}
                      </button>
                    </div>
                  </Row>
                  {/* How they'll pay when they say yes. Picked here
                      because this is the moment the contractor is
                      thinking about this client — and because
                      acceptance is when clients are most willing to
                      pay. On accept the deposit is invoiced on this
                      rail automatically and the portal's Pay button
                      points at it. */}
                  {rails.length > 0 && (
                    <Row label="Pay by">
                      <div className="flex w-full flex-wrap items-center gap-1.5">
                        {[
                          ...rails.map((r) => ({
                            key: r as Rail | null,
                            label: RAIL_LABELS[r],
                          })),
                          { key: null, label: "I'll invoice later" },
                        ].map((o) => (
                          <button
                            key={o.label}
                            type="button"
                            onClick={() => setPayWith(o.key)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                              payWith === o.key
                                ? "border-accent-400 bg-accent-50 text-accent-800"
                                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
                            )}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </Row>
                  )}
                </div>

                {limitHit && (
                  <div className="anim-enter-fade mt-4 rounded-xl border border-accent-200 bg-accent-50 p-4">
                    <div className="flex items-start gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-600 text-white">
                        <Zap className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-accent-900">
                          You&apos;ve used all 3 free proposals this month
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-accent-800/80">
                          Pro sends unlimited proposals. Upgrade takes a
                          minute — come right back and hit send again.
                        </p>
                        <div className="mt-3 flex items-center gap-3">
                          <Button size="sm" onClick={() => upgrade("month")} disabled={upgrading}>
                            {upgrading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Zap className="h-4 w-4" />
                            )}
                            Upgrade to Pro
                          </Button>
                          <button
                            type="button"
                            onClick={() => upgrade("year")}
                            disabled={upgrading}
                            className="ring-focus rounded text-[11px] font-medium text-accent-800 underline-offset-2 hover:underline"
                          >
                            or yearly — 2 months free
                          </button>
                        </div>
                        <div className="mt-1.5 text-[11px] text-accent-800/60">
                          Not now? Your free sends reset next month.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {error && (
                  <div className="anim-enter-fade mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div>
                      <div className="font-medium">Couldn't send</div>
                      <div className="mt-0.5 text-rose-700/90">{error}</div>
                    </div>
                  </div>
                )}

                <div className="mt-6 flex items-center justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleClose}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={send} disabled={pending}>
                    <Mail className="h-4 w-4" />
                    {pending
                      ? "Sending…"
                      : `Send to ${clientName.trim().split(/\s+/)[0] || "client"}`}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center">
                <motion.div
                  initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", damping: 14, stiffness: 220 }}
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200"
                >
                  <Check className="h-6 w-6" />
                </motion.div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900">
                  Proposal sent
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {clientName.trim() || "Your client"} will receive an email and
                  can review, sign, and pay from the portal.
                </p>
                {audioReady && (
                  <p className="mx-auto mt-3 inline-flex max-w-sm items-center gap-2 rounded-lg bg-accent-50 px-3 py-2 text-[12.5px] leading-snug text-accent-800">
                    <Headphones className="h-3.5 w-3.5 shrink-0" />A spoken
                    summary is attached — they can listen to the quote while
                    driving.
                  </p>
                )}
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <Button
                    size="sm"
                    onClick={() =>
                      window.open(
                        sentPortalUrl ?? `/p/${proposal.token}`,
                        "_blank",
                      )
                    }
                  >
                    Open client portal
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleClose}>
                    Back to builder
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2">
      <span className="font-label w-20 shrink-0 text-[10px] text-zinc-500">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
