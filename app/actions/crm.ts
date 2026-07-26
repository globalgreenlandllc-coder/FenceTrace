"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "./me";
import {
  suggestNextAction,
  type ClientProposalSnapshot,
  type NextAction,
} from "@/lib/crm-insights";
import { deriveTotalCentsFromData } from "@/lib/proposal-mock";

/**
 * crm.ts — the client directory. There is deliberately NO Client table:
 * every homeowner the contractor has ever quoted already lives on their
 * proposals, so the directory is derived by grouping proposals on the
 * lowercased client email (fallback: name). Notes attach to that same
 * key via ClientNote. Owner-tenanted throughout.
 */

type VoidResult = { ok: true } | { ok: false; reason: string };

export type CrmProposalRow = {
  id: string;
  address: string;
  status: "DRAFT" | "SENT" | "VIEWED" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  totalCents: number;
  paidCents: number;
  sentAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type CrmClient = {
  /** Stable grouping key — lowercased email, or "name:<slug>" fallback. */
  key: string;
  name: string;
  email: string | null;
  addresses: string[];
  proposalCount: number;
  /** Sum of every proposal's contract value ever quoted. */
  quotedCents: number;
  /** Accepted contract value (won work). */
  wonCents: number;
  paidCents: number;
  lastActivityAt: string;
  latestStatus: CrmProposalRow["status"];
  nextAction: NextAction;
  noteCount: number;
  proposals: CrmProposalRow[];
};

export type CrmNote = {
  id: string;
  body: string;
  createdAt: string;
};

function clientKey(email: string, name: string): string {
  const e = email.trim().toLowerCase();
  if (e) return e;
  return `name:${name.trim().toLowerCase().replace(/\s+/g, "-") || "unknown"}`;
}

export async function getCrmClients(): Promise<CrmClient[]> {
  const me = await getMe();
  if (!me) return [];
  const userId = me.user.id;

  const [rows, noteGroups] = await Promise.all([
    db.proposal.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 500,
      select: {
        id: true,
        address: true,
        clientName: true,
        clientEmail: true,
        status: true,
        totalCents: true,
        paidCents: true,
        selectedPackageId: true,
        data: true,
        sentAt: true,
        acceptedAt: true,
        completedAt: true,
        updatedAt: true,
      },
    }),
    db.clientNote.groupBy({
      by: ["clientKey"],
      where: { userId },
      _count: { _all: true },
    }),
  ]);

  const noteCounts = new Map(
    noteGroups.map((g) => [g.clientKey, g._count._all]),
  );
  const now = new Date();
  const groups = new Map<string, CrmClient>();

  for (const r of rows) {
    const key = clientKey(r.clientEmail, r.clientName);
    const proposal: CrmProposalRow = {
      id: r.id,
      address: r.address,
      status: r.status,
      totalCents: deriveTotalCentsFromData(
        r.data,
        r.totalCents,
        r.selectedPackageId,
      ),
      paidCents: r.paidCents,
      sentAt: r.sentAt?.toISOString() ?? null,
      acceptedAt: r.acceptedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
    };

    let g = groups.get(key);
    if (!g) {
      const snapshot: ClientProposalSnapshot = {
        status: proposal.status,
        sentAt: proposal.sentAt,
        acceptedAt: proposal.acceptedAt,
        completedAt: proposal.completedAt,
        updatedAt: proposal.updatedAt,
      };
      g = {
        key,
        name: r.clientName.trim() || r.clientEmail || "Unnamed client",
        email: r.clientEmail.trim() ? r.clientEmail.trim() : null,
        addresses: [],
        proposalCount: 0,
        quotedCents: 0,
        wonCents: 0,
        paidCents: 0,
        // rows are sorted by updatedAt desc, so the first row seen per
        // key IS the latest — the smart suggestion reads that one.
        lastActivityAt: proposal.updatedAt,
        latestStatus: proposal.status,
        nextAction: suggestNextAction(snapshot, now),
        noteCount: noteCounts.get(key) ?? 0,
        proposals: [],
      };
      groups.set(key, g);
    }
    g.proposalCount += 1;
    g.quotedCents += proposal.totalCents;
    g.paidCents += proposal.paidCents;
    if (proposal.status === "ACCEPTED") g.wonCents += proposal.totalCents;
    if (r.address.trim() && !g.addresses.includes(r.address.trim())) {
      g.addresses.push(r.address.trim());
    }
    g.proposals.push(proposal);
  }

  // Who needs attention first, then most recent activity.
  return [...groups.values()].sort(
    (a, b) =>
      b.nextAction.urgency - a.nextAction.urgency ||
      b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
}

export async function getClientNotes(key: string): Promise<CrmNote[]> {
  const me = await getMe();
  if (!me) return [];
  const notes = await db.clientNote.findMany({
    where: { userId: me.user.id, clientKey: key },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function addClientNote(
  key: string,
  body: string,
): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const clean = (body ?? "").trim();
  if (!clean) return { ok: false, reason: "Write something first" };
  if (!key.trim()) return { ok: false, reason: "Missing client" };
  await db.clientNote.create({
    data: {
      userId: me.user.id,
      clientKey: key.trim().toLowerCase(),
      body: clean.slice(0, 2000),
    },
  });
  revalidatePath("/dashboard/clients");
  return { ok: true };
}

export async function deleteClientNote(id: string): Promise<VoidResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  await db.clientNote.deleteMany({ where: { id, userId: me.user.id } });
  revalidatePath("/dashboard/clients");
  return { ok: true };
}
