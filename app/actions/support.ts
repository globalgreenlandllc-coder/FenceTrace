"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "./me";
import { getActiveApiKey } from "@/lib/api-keys";
import { sendEmailViaResend } from "@/lib/email/resend";
import type { SupportStatus } from "@prisma/client";

/**
 * support.ts — the support inbox: users open tickets to the super-admin and
 * the two sides thread messages back and forth. Admins get emailed on new
 * tickets; users get emailed when the admin replies. AI triages the subject
 * into a category and drafts a suggested reply for the admin.
 */

type Err = { ok: false; reason: string };

async function requireAdmin() {
  const me = await getMe();
  if (!me || me.user.role !== "SUPER_ADMIN") return null;
  return me;
}

// ─── user: open a ticket ────────────────────────────────────────────────────

export async function createSupportTicket(input: {
  subject: string;
  message: string;
}): Promise<{ ok: true; id: string } | Err> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const subject = input.subject.trim();
  const message = input.message.trim();
  if (!subject) return { ok: false, reason: "Add a subject" };
  if (!message) return { ok: false, reason: "Describe what you need help with" };
  if (subject.length > 160) return { ok: false, reason: "Subject is too long" };
  if (message.length > 5000) return { ok: false, reason: "Message is too long" };

  const category = await triageCategory(subject, message);

  const ticket = await db.supportTicket.create({
    data: {
      userId: me.user.id,
      subject,
      status: "OPEN",
      category,
      lastFromAdmin: false,
      messages: {
        create: { authorId: me.user.id, fromAdmin: false, body: message },
      },
    },
    select: { id: true },
  });

  // Notify every super-admin (fire-and-forget; a mail failure must not
  // block the ticket from being created).
  void notifyAdminsOfNewTicket({
    subject,
    message,
    fromName: me.user.name || me.user.email,
    fromEmail: me.user.email,
    category,
  });

  revalidatePath("/dashboard/support");
  return { ok: true, id: ticket.id };
}

export type UserTicket = {
  id: string;
  subject: string;
  status: SupportStatus;
  lastFromAdmin: boolean;
  updatedAt: string;
  messages: {
    id: string;
    fromAdmin: boolean;
    body: string;
    createdAt: string;
  }[];
};

export async function getMyTickets(): Promise<UserTicket[]> {
  const me = await getMe();
  if (!me) return [];
  const rows = await db.supportTicket.findMany({
    where: { userId: me.user.id },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
    take: 50,
  });
  return rows.map(serializeTicket);
}

export async function replyToMyTicket(input: {
  id: string;
  body: string;
}): Promise<{ ok: true } | Err> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  const body = input.body.trim();
  if (!body) return { ok: false, reason: "Write a message" };
  const ticket = await db.supportTicket.findFirst({
    where: { id: input.id, userId: me.user.id },
    select: { id: true },
  });
  if (!ticket) return { ok: false, reason: "Ticket not found" };
  await db.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status: "OPEN",
      lastFromAdmin: false,
      messages: {
        create: { authorId: me.user.id, fromAdmin: false, body },
      },
    },
  });
  void notifyAdminsOfNewTicket({
    subject: "Re: support ticket",
    message: body,
    fromName: me.user.name || me.user.email,
    fromEmail: me.user.email,
    category: null,
    isReply: true,
  });
  revalidatePath("/dashboard/support");
  return { ok: true };
}

// ─── admin: inbox ───────────────────────────────────────────────────────────

export type AdminTicket = {
  id: string;
  subject: string;
  status: SupportStatus;
  category: string | null;
  lastFromAdmin: boolean;
  updatedAt: string;
  createdAt: string;
  requesterName: string;
  requesterEmail: string;
  messages: {
    id: string;
    fromAdmin: boolean;
    body: string;
    createdAt: string;
  }[];
};

export async function listSupportTickets(): Promise<AdminTicket[]> {
  const me = await requireAdmin();
  if (!me) return [];
  const rows = await db.supportTicket.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: {
      user: { select: { name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
    take: 200,
  });
  return rows.map((r) => ({
    ...serializeTicket(r),
    category: r.category,
    createdAt: r.createdAt.toISOString(),
    requesterName: r.user.name || r.user.email,
    requesterEmail: r.user.email,
  }));
}

export async function adminReplyToTicket(input: {
  id: string;
  body: string;
  resolve?: boolean;
}): Promise<{ ok: true } | Err> {
  const me = await requireAdmin();
  if (!me) return { ok: false, reason: "Admins only" };
  const body = input.body.trim();
  if (!body) return { ok: false, reason: "Write a reply" };
  const ticket = await db.supportTicket.findUnique({
    where: { id: input.id },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!ticket) return { ok: false, reason: "Ticket not found" };

  await db.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status: input.resolve ? "RESOLVED" : "PENDING",
      lastFromAdmin: true,
      messages: { create: { authorId: me.user.id, fromAdmin: true, body } },
    },
  });

  // Email the requester their reply.
  void sendEmailViaResend({
    to: ticket.user.email,
    fromName: "FenceTrace Support",
    subject: `Re: ${ticket.subject}`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto">
      <p style="color:#27303a;font-size:15px;line-height:1.6;white-space:pre-wrap">${escapeHtml(body)}</p>
      <hr style="border:none;border-top:1px solid #e6ebef;margin:20px 0 10px">
      <p style="font-size:12px;color:#8a97a1">Reply to this email or open Support in your dashboard to continue the conversation.</p>
    </div>`,
    text: `${body}\n\n— FenceTrace Support`,
  });

  revalidatePath("/admin/support");
  return { ok: true };
}

export async function setTicketStatus(input: {
  id: string;
  status: SupportStatus;
}): Promise<{ ok: true } | Err> {
  const me = await requireAdmin();
  if (!me) return { ok: false, reason: "Admins only" };
  await db.supportTicket
    .update({ where: { id: input.id }, data: { status: input.status } })
    .catch(() => null);
  revalidatePath("/admin/support");
  return { ok: true };
}

// ─── admin: AI suggested reply ──────────────────────────────────────────────

export async function suggestSupportReply(
  id: string,
): Promise<{ ok: true; reply: string } | Err> {
  const me = await requireAdmin();
  if (!me) return { ok: false, reason: "Admins only" };
  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) return { ok: false, reason: "Ticket not found" };

  const apiKey =
    (await getActiveApiKey("ANTHROPIC")) ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey) return { ok: false, reason: "Anthropic API key not configured" };

  const thread = ticket.messages
    .map((m) => `${m.fromAdmin ? "Support" : "Customer"}: ${m.body}`)
    .join("\n\n");

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 700,
      system:
        "You are a support agent for FenceTrace, a web app that lets fence contractors estimate jobs from a satellite property scan and send proposals. Write a concise, warm, professional reply the human agent can send as-is. No greeting boilerplate beyond a short hello, no sign-off name (the app appends one). If you're unsure of an app specific, say you'll look into it rather than inventing steps.",
      messages: [
        {
          role: "user",
          content: `Ticket subject: ${ticket.subject}\n\nConversation so far:\n${thread}\n\nDraft the next reply from Support.`,
        },
      ],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return { ok: false, reason: "The AI didn't return a draft" };
    return { ok: true, reply: text };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "AI draft failed" };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function serializeTicket(r: {
  id: string;
  subject: string;
  status: SupportStatus;
  lastFromAdmin: boolean;
  updatedAt: Date;
  messages: { id: string; fromAdmin: boolean; body: string; createdAt: Date }[];
}) {
  return {
    id: r.id,
    subject: r.subject,
    status: r.status,
    lastFromAdmin: r.lastFromAdmin,
    updatedAt: r.updatedAt.toISOString(),
    messages: r.messages.map((m) => ({
      id: m.id,
      fromAdmin: m.fromAdmin,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

async function triageCategory(
  subject: string,
  message: string,
): Promise<string | null> {
  const apiKey =
    (await getActiveApiKey("ANTHROPIC")) ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      system:
        "Classify the support ticket into exactly one word from: billing, bug, howto, feature, account, other. Reply with only that word.",
      messages: [
        { role: "user", content: `Subject: ${subject}\n\n${message}`.slice(0, 1500) },
      ],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .toLowerCase();
    const known = ["billing", "bug", "howto", "feature", "account", "other"];
    return known.find((k) => raw.includes(k)) ?? null;
  } catch {
    return null;
  }
}

async function notifyAdminsOfNewTicket(args: {
  subject: string;
  message: string;
  fromName: string;
  fromEmail: string;
  category: string | null;
  isReply?: boolean;
}): Promise<void> {
  try {
    const admins = await db.user.findMany({
      where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      select: { email: true },
    });
    if (admins.length === 0) return;
    const tag = args.isReply ? "New reply" : "New support ticket";
    const html = `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#14688C">${tag}${args.category ? ` · ${args.category}` : ""}</div>
      <h2 style="font-size:18px;margin:8px 0 4px;color:#16262e">${escapeHtml(args.subject)}</h2>
      <p style="font-size:13px;color:#8a97a1;margin:0 0 12px">from ${escapeHtml(args.fromName)} &lt;${escapeHtml(args.fromEmail)}&gt;</p>
      <p style="color:#27303a;font-size:15px;line-height:1.6;white-space:pre-wrap">${escapeHtml(args.message)}</p>
      <hr style="border:none;border-top:1px solid #e6ebef;margin:20px 0 10px">
      <p style="font-size:12px;color:#8a97a1">Open Support in the admin dashboard to reply.</p>
    </div>`;
    for (const a of admins) {
      await sendEmailViaResend({
        to: a.email,
        fromName: "FenceTrace",
        replyTo: args.fromEmail,
        subject: `[Support] ${args.subject}`,
        html,
        text: `${tag} from ${args.fromName} <${args.fromEmail}>\n\n${args.subject}\n\n${args.message}`,
      });
    }
  } catch {
    // best-effort
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
