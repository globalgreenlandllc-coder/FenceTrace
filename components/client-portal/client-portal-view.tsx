"use client";

import { useState, useTransition } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ShieldCheck, Phone, Mail } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand-mark";
import { useProfile } from "@/lib/auth-mock";
import { AerialSection } from "@/components/proposal/aerial-section";
import { PackagesSection } from "@/components/proposal/packages-section";
import { PhotosSection } from "@/components/proposal/photos-section";
import { TermsSection } from "@/components/proposal/terms-section";
import { SignaturePad } from "./signature-pad";
import { ListenCard } from "./listen-card";
import { AcceptBar } from "./accept-bar";
import { AcceptedScreen } from "./accepted-screen";
import { PaymentHub } from "./payment-hub";
import { DiscountThread } from "./discount-thread";
import { packageTotal, type Proposal } from "@/lib/proposal-mock";
import { DUR, EASE } from "@/lib/motion";
import { acceptProposalByToken } from "@/app/actions/proposals";
import type { PortalPaymentState } from "@/app/actions/payments";
import type { DiscountThreadDto } from "@/app/actions/discounts";

export function ClientPortalView({
  proposal,
  previewMode,
  portal,
  discountThread,
  audioEnabled,
}: {
  proposal: Proposal;
  previewMode?: boolean;
  /** Post-acceptance payment state (schedule, change orders). When set,
   *  the portal renders the payment hub instead of the accept flow. */
  portal?: PortalPaymentState | null;
  /** Pre-acceptance price-negotiation state. Null in preview/demo mode. */
  discountThread?: DiscountThreadDto | null;
  /** Shows the "Listen to this quote" TTS player. Only set for real
   *  persisted proposals — the demo/sample portal has no row to cache
   *  audio on, and preview mode shouldn't burn TTS on drafts. */
  audioEnabled?: boolean;
}) {
  const recommended =
    proposal.packages.find((p) => p.recommended)?.id ??
    proposal.packages[1]?.id ??
    proposal.packages[0]?.id;

  const [selectedId, setSelectedId] = useState<string>(recommended);
  const [signature, setSignature] = useState<string | null>(null);
  const [signerName, setSignerName] = useState(proposal.client.name);
  const [agreed, setAgreed] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<"deposit" | "full">(
    "deposit",
  );
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [, startAccept] = useTransition();
  const [acceptPending, setAcceptPending] = useState(false);
  const reduce = useReducedMotion();

  const selected =
    proposal.packages.find((p) => p.id === selectedId) ?? proposal.packages[0];
  const totals = packageTotal(
    selected,
    proposal.measurements,
    proposal.discountPct ?? 0,
  );
  // List price at zero discount — drives the accept-bar strikethrough so a
  // negotiated win is visible right where the client commits.
  const hasDiscount = (proposal.discountPct ?? 0) > 0;
  const listTotal = hasDiscount
    ? packageTotal(selected, proposal.measurements, 0).total
    : undefined;

  const canAccept =
    !!signature &&
    signerName.trim().length > 1 &&
    agreed &&
    !previewMode;

  let reason: string | undefined;
  if (previewMode) reason = "Preview mode — accepting is disabled";
  else if (!signature) reason = "Sign above to enable accept";
  else if (signerName.trim().length <= 1) reason = "Add your printed name";
  else if (!agreed) reason = "Acknowledge the terms to continue";

  // Accepted proposals get the payment hub: schedule, progress, pay
  // buttons and change-order approvals. The accept flow below only
  // renders while the proposal is still open.
  if (portal && !previewMode) {
    return (
      <div className="relative">
        <PortalNav proposal={proposal} />
        <PaymentHub
          proposal={proposal}
          initialState={portal}
          token={proposal.token}
        />
      </div>
    );
  }

  if (accepted) {
    const due =
      totals.total *
      (paymentChoice === "deposit" ? proposal.depositPct / 100 : 1);
    return (
      <AcceptedScreen
        packageName={selected.name}
        amount={due}
        contractor={{
          name: proposal.contractor.name,
          company: proposal.contractor.company,
          email: proposal.contractor.email,
          stripePaymentUrl: proposal.contractor.stripePaymentUrl ?? null,
          squarePaymentUrl: proposal.contractor.squarePaymentUrl ?? null,
        }}
        signerName={signerName}
      />
    );
  }

  return (
    <div className="relative">
      {!previewMode && <PortalNav proposal={proposal} />}

      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.entrance, ease: EASE }}
          className="space-y-8"
        >
          <Header proposal={proposal} />

          {audioEnabled && !previewMode && (
            <ListenCard
              token={proposal.token}
              address={proposal.address}
              company={proposal.contractor.company || "Your contractor"}
            />
          )}

          <AerialSection proposal={proposal} />

          <PackagesSection
            proposal={proposal}
            onChange={() => undefined}
            readOnly
            selectedPackageId={selectedId}
            onSelectPackage={setSelectedId}
          />

          {discountThread && !previewMode && (
            <DiscountThread
              token={proposal.token}
              initial={discountThread}
              selectedPackageId={selectedId}
              companyName={proposal.contractor.company || "your contractor"}
            />
          )}

          <PhotosSection
            proposal={proposal}
            onChange={() => undefined}
            readOnly
          />

          <TermsSection
            proposal={proposal}
            onChange={() => undefined}
            readOnly
          />

          <section className="space-y-4">
            <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
              Sign & accept
            </h2>
            <SignaturePad
              value={signature}
              onChange={setSignature}
              signerName={signerName}
              onSignerName={setSignerName}
            />
            <label className="transition-smooth flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-card hover:border-zinc-300">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="ring-focus mt-1 h-4 w-4 rounded border-zinc-300 accent-accent-600"
              />
              <span className="text-sm text-zinc-700">
                I authorize {proposal.contractor.company} to perform the
                described scope of work and agree to the terms above. I confirm
                I'm authorized to sign for this property.
              </span>
            </label>
          </section>

          <ContactCard contractor={proposal.contractor} />

          {/* Growth loop: every proposal reaches a homeowner — and some
              homeowners are contractors. Quiet, but always present. */}
          <div className="pb-2 text-center print:hidden">
            <a
              href="/?ref=proposal"
              target="_blank"
              rel="noopener"
              className="transition-smooth text-xs text-zinc-400 hover:text-accent-700"
            >
              ⚡ Powered by <span className="font-semibold">FenceScan</span> —
              send quotes like this in 60 seconds →
            </a>
          </div>
          <div className="h-32 print:hidden" />
        </motion.div>
      </main>

      <AcceptBar
        packageName={selected.name}
        total={totals.total}
        listTotal={listTotal}
        depositPct={proposal.depositPct}
        paymentChoice={paymentChoice}
        onPaymentChoice={setPaymentChoice}
        canAccept={canAccept && !acceptPending}
        reason={acceptError ?? reason}
        onAccept={() => {
          if (previewMode) {
            setAccepted(true);
            return;
          }
          setAcceptError(null);
          setAcceptPending(true);
          startAccept(async () => {
            try {
              const result = await acceptProposalByToken({
                token: proposal.token,
                signerName: signerName.trim(),
                signatureDataUrl: signature ?? "",
                selectedPackageId: selectedId,
                paymentChoice,
              });
              if (!result.ok) {
                setAcceptError(result.reason);
                return;
              }
              setAccepted(true);
            } catch (e) {
              setAcceptError(
                e instanceof Error ? e.message : "Couldn't accept the proposal",
              );
            } finally {
              setAcceptPending(false);
            }
          });
        }}
      />
    </div>
  );
}

function PortalNav({ proposal }: { proposal: Proposal }) {
  const profile = useProfile();
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white print:hidden">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <BrandMark
            initials={profile.logo.initials || "FT"}
            tone={profile.logo.tone}
            logoUrl={profile.logo.url}
            size="sm"
          />
          <div className="leading-none">
            <div className="text-sm font-semibold text-zinc-900">
              {proposal.contractor.company}
            </div>
            <div className="font-label mt-0.5 text-[10px] text-zinc-500">
              Proposal
            </div>
          </div>
        </div>
        <div className="hidden items-center gap-3 text-xs text-zinc-500 sm:flex">
          <Badge tone="neutral">
            <ShieldCheck className="h-3 w-3" />
            Secured by FenceScan
          </Badge>
          <span>·</span>
          <Logo showSubtitle={false} className="opacity-70" />
        </div>
      </div>
    </header>
  );
}

function Header({ proposal }: { proposal: Proposal }) {
  const profile = useProfile();
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card sm:p-8">
      <div className="flex flex-wrap items-start gap-4">
        <BrandMark
          initials={profile.logo.initials || "FT"}
          tone={profile.logo.tone}
          logoUrl={profile.logo.url}
          size="xl"
        />
        <div className="min-w-0 flex-1">
          <Badge>For {proposal.client.name}</Badge>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Your fence quote from{" "}
            <span className="text-accent-700">
              {proposal.contractor.company}
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-balance text-base leading-relaxed text-zinc-600">
            {proposal.intro}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <Badge tone="neutral">{proposal.address}</Badge>
            <span>·</span>
            <span>Valid for {proposal.validDays} days</span>
            <span>·</span>
            <span>Prepared by {proposal.contractor.name}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactCard({
  contractor,
}: {
  contractor: Proposal["contractor"];
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
      <div className="font-label text-[11px] text-zinc-500">
        Questions? Talk to your contractor
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <div className="font-medium text-zinc-900">{contractor.name}</div>
          <div className="text-sm text-zinc-500">{contractor.company}</div>
        </div>
        <a
          href={`tel:${contractor.phone}`}
          className="transition-smooth ring-focus inline-flex items-center gap-2 rounded-md text-sm text-zinc-700 hover:text-accent-700"
        >
          <Phone className="h-4 w-4" />
          {contractor.phone}
        </a>
        <a
          href={`mailto:${contractor.email}`}
          className="transition-smooth ring-focus inline-flex items-center gap-2 rounded-md text-sm text-zinc-700 hover:text-accent-700"
        >
          <Mail className="h-4 w-4" />
          {contractor.email}
        </a>
      </div>
    </div>
  );
}
