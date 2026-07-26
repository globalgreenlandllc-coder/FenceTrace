"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Pencil, X } from "lucide-react";
import { DUR, EASE, SPRING } from "@/lib/motion";
import { blankProposal, type Proposal } from "@/lib/proposal-mock";
import {
  clearEstimateHandoff,
  readEstimateHandoff,
} from "@/lib/estimate-handoff";
import { AuthGate } from "@/components/auth/auth-gate";
import { ProposalTopBar } from "@/components/proposal/proposal-top-bar";
import { CoverSection } from "@/components/proposal/cover-section";
import { AerialSection } from "@/components/proposal/aerial-section";
import { PackagesSection } from "@/components/proposal/packages-section";
import { PhotosSection } from "@/components/proposal/photos-section";
import { TermsSection } from "@/components/proposal/terms-section";
import { BuilderSidebar } from "@/components/proposal/builder-sidebar";
import { MaterialsBuilder } from "@/components/proposal/materials-builder";
import { SendModal } from "@/components/proposal/send-modal";
import { ClientPortalView } from "@/components/client-portal/client-portal-view";
import { useProfile } from "@/lib/auth-mock";
import { getMyProposal } from "@/app/actions/dashboard";
import { deleteProposal, saveProposalDraft } from "@/app/actions/proposals";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

export default function ProposalPage() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <Inner />
      </Suspense>
    </AuthGate>
  );
}

function Inner() {
  const reduce = useReducedMotion();
  const router = useRouter();
  const params = useSearchParams();
  const proposalId = params.get("id");
  // ?manual=1 — contractor chose "Start a manual estimate" from the
  // New-estimate dialog. Forces a blank proposal and discards any stale
  // handoff so a prior AI run doesn't leak in.
  const manual = params.get("manual") === "1";
  const profile = useProfile();
  const [proposal, setProposal] = useState<Proposal>(blankProposal);
  const [preview, setPreview] = useState(false);
  // When the contractor pops into preview to QA the client view, they
  // still need to be able to nudge price / discount / deposit without
  // bouncing back to Edit mode. `editDrawerOpen` flips on a slide-over
  // panel that hosts the BuilderSidebar right on top of the preview.
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  // Package id whose materials builder is open (null = closed). Lifted to
  // the page so the same drawer can be launched from the editor cards,
  // the editor sidebar, OR the preview "Edit price & details" drawer.
  const [materialsEditId, setMaterialsEditId] = useState<string | null>(null);
  const [handoffApplied, setHandoffApplied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Persistence: `savedId` is the DB row this draft maps to (null until
  // first save/create). `hydratedIdRef` stops the loader effect from
  // refetching + clobbering edits when we adopt a freshly-created id into
  // the URL. Save is explicit-first, then debounced autosave keeps it
  // current.
  const [savedId, setSavedId] = useState<string | null>(proposalId);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const hydratedIdRef = useRef<string | null>(null);

  // Three ways the editor gets seeded:
  //   1. ?id=<proposalId> → load the saved row from the DB so the
  //      contractor can edit / re-send an existing draft. Without this
  //      the editor was starting from blankProposal and the send modal
  //      rejected with "Property address is required".
  //   2. ?manual=1 → blank proposal, skip handoff entirely.
  //   3. handoff in localStorage → fresh from the /estimate flow.
  // ?id wins when both are present so a re-opened draft never gets
  // overwritten by stale handoff data left behind in localStorage.
  useEffect(() => {
    // Already hydrated this id (or we just created it via Save and pushed
    // ?id= into the URL) — skip the refetch so it can't overwrite the
    // contractor's in-progress edits with the just-saved copy.
    if (proposalId && hydratedIdRef.current === proposalId) {
      setHandoffApplied(true);
      return;
    }
    let cancelled = false;
    async function init() {
      if (proposalId) {
        const loaded = await getMyProposal(proposalId);
        if (cancelled) return;
        if (loaded) {
          setProposal(loaded);
          clearEstimateHandoff();
          hydratedIdRef.current = proposalId;
          setSavedId(proposalId);
          setHandoffApplied(true);
          return;
        }
      }
      if (manual) {
        // Drop any handoff that might still be in localStorage so it
        // can't bleed into the blank manual proposal.
        clearEstimateHandoff();
        setHandoffApplied(true);
        return;
      }
      const handoff = readEstimateHandoff();
      if (handoff) {
        setProposal((p) => ({
          ...p,
          address: handoff.address,
          measurements: handoff.measurements,
          takeoff: {
            eaves: handoff.eaves,
            rakes: handoff.rakes,
            downspouts: handoff.downspouts,
            suggestedEaves: handoff.suggestedEaves,
            roofStructure: handoff.roofStructure,
            aerial: handoff.aerial,
            canvasPxPerFt: handoff.canvasPxPerFt,
          },
        }));
        clearEstimateHandoff();
      }
      if (!cancelled) setHandoffApplied(true);
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [proposalId, manual]);

  useEffect(() => {
    setProposal((p) => ({
      ...p,
      contractor: {
        ...p.contractor,
        company: profile.company,
        name: profile.contractorName,
        email: profile.email,
        phone: profile.phone,
        license: profile.license,
        stripePaymentUrl: profile.payments.stripeUrl,
        squarePaymentUrl: profile.payments.squareUrl,
      },
    }));
  }, [
    profile.company,
    profile.contractorName,
    profile.email,
    profile.phone,
    profile.license,
    profile.payments.stripeUrl,
    profile.payments.squareUrl,
  ]);

  // Debounced autosave. Only runs once the draft already has a row
  // (savedId) so merely opening /proposal never auto-creates a surprise
  // draft — the first persist is an explicit Save (or Send). After that,
  // every edit (materials, BOM, price, address…) is flushed 1.5s later.
  useEffect(() => {
    if (!handoffApplied || !savedId || !proposal.address.trim()) return;
    const t = setTimeout(async () => {
      setSaveState({ kind: "saving" });
      const res = await saveProposalDraft({ proposal, proposalId: savedId });
      setSaveState(
        res.ok
          ? { kind: "saved", at: Date.now() }
          : { kind: "error", message: res.reason },
      );
    }, 1500);
    return () => clearTimeout(t);
  }, [proposal, handoffApplied, savedId]);

  // Avoid a one-frame flash of the sample numbers while we read
  // localStorage. handoffApplied flips true on the first mount effect.
  if (!handoffApplied) return null;

  function download() {
    if (typeof window !== "undefined") window.print();
  }

  async function handleSave() {
    if (!proposal.address.trim()) {
      setSaveState({ kind: "error", message: "Add a property address first" });
      return;
    }
    setSaveState({ kind: "saving" });
    const res = await saveProposalDraft({ proposal, proposalId: savedId });
    if (res.ok) {
      setSaveState({ kind: "saved", at: Date.now() });
      if (!savedId) {
        // Adopt the new row id into the URL so a manual browser reload
        // restores it. hydratedIdRef set first so the loader effect skips
        // the refetch when ?id= appears.
        hydratedIdRef.current = res.id;
        setSavedId(res.id);
        router.replace(`/proposal?id=${res.id}`, { scroll: false });
      }
    } else {
      setSaveState({ kind: "error", message: res.reason });
    }
  }

  async function handleDelete() {
    if (!proposalId) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteProposal(proposalId);
    if (result.ok) {
      router.replace("/dashboard/proposals");
    } else {
      setDeleting(false);
      setDeleteError(result.reason);
    }
  }

  const materialsPkg = materialsEditId
    ? (proposal.packages.find((p) => p.id === materialsEditId) ?? null)
    : null;

  return (
    <div className="min-h-screen">
      <ProposalTopBar
        address={proposal.address}
        preview={preview}
        proposalId={proposalId}
        onTogglePreview={() => setPreview((v) => !v)}
        onSend={() => setSendOpen(true)}
        onDownload={download}
        onSave={handleSave}
        saving={saveState.kind === "saving"}
        saved={saveState.kind === "saved"}
        onDelete={handleDelete}
        deleting={deleting}
      />

      {deleteError && (
        <div className="anim-enter-fade border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-xs text-rose-700">
          Couldn&apos;t delete proposal: {deleteError}
        </div>
      )}

      {saveState.kind === "error" && (
        <div className="anim-enter-fade border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-xs text-rose-700">
          Couldn&apos;t save: {saveState.message}
        </div>
      )}

      {preview ? (
        <>
          <ClientPortalView proposal={proposal} previewMode />

          {/* Floating "Edit price" pill — sits at the bottom-right while
              the contractor is in preview mode so they can adjust price,
              discount, deposit, or recipient WITHOUT having to leave
              preview. Tapping it opens the slide-over drawer below. */}
          {!editDrawerOpen && (
            <button
              type="button"
              onClick={() => setEditDrawerOpen(true)}
              className="anim-enter-fade hover-lift press-scale ring-focus fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-elevated ring-1 ring-black/10 hover:bg-zinc-800 print:hidden"
            >
              <Pencil className="h-4 w-4" />
              Edit price & details
            </button>
          )}

          {/* Slide-over edit drawer — full BuilderSidebar overlaid on
              the client preview so changes update both views in real
              time. Backdrop click + ESC close. */}
          {editDrawerOpen && (
            <div className="fixed inset-0 z-40 print:hidden">
              <motion.button
                type="button"
                aria-label="Close editor"
                onClick={() => setEditDrawerOpen(false)}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: DUR.base, ease: EASE }}
                className="absolute inset-0 bg-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/40"
              />
              <motion.aside
                initial={reduce ? false : { x: "100%" }}
                animate={{ x: 0 }}
                transition={SPRING}
                className="absolute right-0 top-0 flex h-full w-[420px] max-w-[92vw] flex-col gap-3 overflow-y-auto border-l border-zinc-200 bg-zinc-50 p-4 shadow-elevated"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-label text-[10px] text-zinc-500">
                      Live edit
                    </div>
                    <div className="text-sm font-medium text-zinc-900">
                      Adjust price while previewing
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditDrawerOpen(false)}
                    className="ring-focus active:scale-[0.98] inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-smooth hover:bg-zinc-50"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <BuilderSidebar
                  proposal={proposal}
                  onChange={setProposal}
                  onSend={() => {
                    setEditDrawerOpen(false);
                    setSendOpen(true);
                  }}
                  onEditMaterials={setMaterialsEditId}
                />
              </motion.aside>
            </div>
          )}
        </>
      ) : (
        <main className="mx-auto grid max-w-[1600px] gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-6 lg:py-8">
          <div className="space-y-8">
            <CoverSection proposal={proposal} onChange={setProposal} />
            <AerialSection proposal={proposal} onChange={setProposal} />
            <PackagesSection
              proposal={proposal}
              onChange={setProposal}
              onEditMaterials={setMaterialsEditId}
            />
            <PhotosSection proposal={proposal} onChange={setProposal} />
            <TermsSection proposal={proposal} onChange={setProposal} />
          </div>
          <div className="lg:sticky lg:top-[80px] lg:self-start">
            <BuilderSidebar
              proposal={proposal}
              onChange={setProposal}
              onSend={() => setSendOpen(true)}
              onEditMaterials={setMaterialsEditId}
            />
          </div>
        </main>
      )}

      {materialsPkg && (
        <MaterialsBuilder
          pkg={materialsPkg}
          allPackages={proposal.packages}
          measurements={proposal.measurements}
          discountPct={proposal.discountPct ?? 0}
          address={proposal.address}
          onChange={(next) =>
            setProposal((prev) => ({
              ...prev,
              packages: prev.packages.map((p) =>
                p.id === next.id ? next : p,
              ),
            }))
          }
          onChangeAll={(next) =>
            setProposal((prev) => ({ ...prev, packages: next }))
          }
          onClose={() => setMaterialsEditId(null)}
        />
      )}

      <SendModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        proposal={proposal}
      />
    </div>
  );
}
