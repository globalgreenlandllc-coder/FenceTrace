"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getMe } from "./me";
import { getActiveApiKey } from "@/lib/api-keys";
import { sendEmailViaResend } from "@/lib/email/resend";
import type {
  AnnouncementAudience,
  AnnouncementLevel,
} from "@prisma/client";

/**
 * announcements.ts — the super-admin broadcast system.
 *
 * Admin composes an announcement (optionally AI-polished), publishes it so
 * it shows in-app to the chosen audience, and can additionally email it to
 * every recipient. Users see published announcements as a banner and can
 * dismiss each one (per-user). All admin writes are SUPER_ADMIN-gated.
 */

type Ok<T> = { ok: true } & T;
type Err = { ok: false; reason: string };

async function requireAdmin() {
  const me = await getMe();
  if (!me) return { me: null, error: "Not signed in" as const };
  if (me.user.role !== "SUPER_ADMIN")
    return { me: null, error: "Admins only" as const };
  return { me, error: null };
}

const LEVELS: AnnouncementLevel[] = ["INFO", "SUCCESS", "WARNING", "CRITICAL"];
const AUDIENCES: AnnouncementAudience[] = ["ALL", "CONTRACTORS", "WORKERS"];

// ─── admin: list ──────────────────────────────────────────────────────────

export type AdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  audience: AnnouncementAudience;
  publishedAt: string | null;
  emailedAt: string | null;
  emailCount: number;
  dismissedCount: number;
  createdAt: string;
  authorName: string;
};

export async function listAnnouncements(): Promise<
  Ok<{ announcements: AdminAnnouncement[] }> | Err
> {
  const { error } = await requireAdmin();
  if (error) return { ok: false, reason: error };
  const rows = await db.announcement.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { name: true, email: true } },
      _count: { select: { dismissals: true } },
    },
    take: 100,
  });
  return {
    ok: true,
    announcements: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      level: r.level,
      audience: r.audience,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      emailedAt: r.emailedAt?.toISOString() ?? null,
      emailCount: r.emailCount,
      dismissedCount: r._count.dismissals,
      createdAt: r.createdAt.toISOString(),
      authorName: r.createdBy.name || r.createdBy.email,
    })),
  };
}

// ─── admin: create / update / publish / delete ─────────────────────────────

export async function saveAnnouncement(input: {
  id?: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  audience: AnnouncementAudience;
  publish?: boolean;
}): Promise<Ok<{ id: string }> | Err> {
  const { me, error } = await requireAdmin();
  if (error || !me) return { ok: false, reason: error ?? "Admins only" };

  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return { ok: false, reason: "Give the announcement a title" };
  if (!body) return { ok: false, reason: "Write the announcement body" };
  if (title.length > 140)
    return { ok: false, reason: "Title is too long (140 max)" };
  if (body.length > 4000)
    return { ok: false, reason: "Body is too long (4000 max)" };
  const level = LEVELS.includes(input.level) ? input.level : "INFO";
  const audience = AUDIENCES.includes(input.audience) ? input.audience : "ALL";

  let id = input.id ?? null;
  if (id) {
    // Only touch publishedAt when the caller explicitly flips it.
    const existing = await db.announcement.findUnique({
      where: { id },
      select: { publishedAt: true },
    });
    if (!existing) return { ok: false, reason: "Announcement not found" };
    const publishedAt =
      input.publish === undefined
        ? existing.publishedAt
        : input.publish
          ? (existing.publishedAt ?? new Date())
          : null;
    await db.announcement.update({
      where: { id },
      data: { title, body, level, audience, publishedAt },
    });
  } else {
    const created = await db.announcement.create({
      data: {
        title,
        body,
        level,
        audience,
        createdById: me.user.id,
        publishedAt: input.publish ? new Date() : null,
      },
      select: { id: true },
    });
    id = created.id;
  }
  revalidatePath("/admin/announcements");
  return { ok: true, id };
}

export async function deleteAnnouncement(
  id: string,
): Promise<{ ok: true } | Err> {
  const { error } = await requireAdmin();
  if (error) return { ok: false, reason: error };
  await db.announcement.delete({ where: { id } }).catch(() => null);
  revalidatePath("/admin/announcements");
  return { ok: true };
}

// ─── admin: email broadcast ────────────────────────────────────────────────

function audienceRoleFilter(audience: AnnouncementAudience) {
  if (audience === "CONTRACTORS") return { role: "CONTRACTOR" as const };
  if (audience === "WORKERS") return { role: "WORKER" as const };
  return {}; // ALL
}

const LEVEL_STYLE: Record<AnnouncementLevel, { label: string; color: string }> = {
  INFO: { label: "Update", color: "#14688C" },
  SUCCESS: { label: "Good news", color: "#0e7a4d" },
  WARNING: { label: "Heads up", color: "#b45309" },
  CRITICAL: { label: "Important", color: "#b91c1c" },
};

export async function broadcastAnnouncementEmail(
  id: string,
): Promise<Ok<{ sent: number; failed: number }> | Err> {
  const { error } = await requireAdmin();
  if (error) return { ok: false, reason: error };

  const a = await db.announcement.findUnique({ where: { id } });
  if (!a) return { ok: false, reason: "Announcement not found" };
  if (!a.publishedAt)
    return { ok: false, reason: "Publish the announcement before emailing it" };

  const recipients = await db.user.findMany({
    where: {
      status: "ACTIVE",
      role: { not: "SUPER_ADMIN" },
      ...audienceRoleFilter(a.audience),
    },
    select: { email: true, name: true },
  });
  if (recipients.length === 0)
    return { ok: false, reason: "No recipients match this audience" };

  const style = LEVEL_STYLE[a.level];
  const bodyHtml = a.body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;line-height:1.6;color:#27303a;font-size:15px">${escapeHtml(
          p,
        ).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:8px 4px">
    <div style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${style.color};margin-bottom:10px">${style.label}</div>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 14px;color:#16262e">${escapeHtml(a.title)}</h1>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #e6ebef;margin:22px 0 12px">
    <p style="font-size:12px;color:#8a97a1;margin:0">You're receiving this because you have a FenceScan account.</p>
  </div>`;
  const text = `${style.label.toUpperCase()}\n\n${a.title}\n\n${a.body}\n\n— FenceScan`;

  let sent = 0;
  let failed = 0;
  // Serialize through the shared Resend chokepoint so its per-day global
  // cap and reputation guards apply. Small user bases; no batching yet.
  for (const r of recipients) {
    const res = await sendEmailViaResend({
      to: r.email,
      fromName: "FenceScan",
      subject: a.title,
      html,
      text,
    });
    if (res.ok) sent++;
    else failed++;
  }

  await db.announcement.update({
    where: { id },
    data: { emailedAt: new Date(), emailCount: { increment: sent } },
  });
  revalidatePath("/admin/announcements");
  return { ok: true, sent, failed };
}

// ─── admin: AI draft / polish ──────────────────────────────────────────────

export async function polishAnnouncementCopy(input: {
  prompt: string;
  level: AnnouncementLevel;
  audience: AnnouncementAudience;
}): Promise<Ok<{ title: string; body: string }> | Err> {
  const { error } = await requireAdmin();
  if (error) return { ok: false, reason: error };
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, reason: "Type a few notes for the AI first" };

  const apiKey =
    (await getActiveApiKey("ANTHROPIC")) ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey) return { ok: false, reason: "Anthropic API key not configured" };

  const audienceWord =
    input.audience === "CONTRACTORS"
      ? "fence contractors (the business owners)"
      : input.audience === "WORKERS"
        ? "crew members / installers"
        : "all users (contractors and crew)";
  const toneWord =
    input.level === "CRITICAL"
      ? "urgent and clear"
      : input.level === "WARNING"
        ? "direct, a heads-up"
        : input.level === "SUCCESS"
          ? "upbeat"
          : "friendly and professional";

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 900,
      tools: [
        {
          name: "write_announcement",
          description: "Return the polished announcement title and body.",
          input_schema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "A short, specific headline (≤ 90 chars).",
              },
              body: {
                type: "string",
                description:
                  "The announcement body, 1–3 short paragraphs, plain text (no markdown). Speak directly to the reader.",
              },
            },
            required: ["title", "body"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "write_announcement" },
      messages: [
        {
          role: "user",
          content: `Write a product announcement for FenceScan (a fence-estimating web app). Audience: ${audienceWord}. Tone: ${toneWord}. Keep it tight and concrete — no fluff, no emoji, no markdown. Notes from the founder:\n\n${prompt}`,
        },
      ],
    });
    const tool = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const out = tool?.input as { title?: unknown; body?: unknown } | undefined;
    const title = typeof out?.title === "string" ? out.title.trim() : "";
    const body = typeof out?.body === "string" ? out.body.trim() : "";
    if (!title || !body)
      return { ok: false, reason: "The AI didn't return usable copy — try again" };
    return { ok: true, title: title.slice(0, 140), body: body.slice(0, 4000) };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "AI drafting failed",
    };
  }
}

// ─── user: active banner + dismiss ─────────────────────────────────────────

export type UserAnnouncement = {
  id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  publishedAt: string;
};

/** Published announcements for the signed-in user's role that they haven't
 *  dismissed yet — newest first, capped so the banner never stacks forever. */
export async function getActiveAnnouncements(): Promise<UserAnnouncement[]> {
  const me = await getMe();
  if (!me) return [];
  const roleAudiences: AnnouncementAudience[] =
    me.user.role === "WORKER" ? ["ALL", "WORKERS"] : ["ALL", "CONTRACTORS"];
  const rows = await db.announcement.findMany({
    where: {
      publishedAt: { not: null },
      audience: { in: roleAudiences },
      dismissals: { none: { userId: me.user.id } },
    },
    orderBy: { publishedAt: "desc" },
    take: 5,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    level: r.level,
    publishedAt: r.publishedAt!.toISOString(),
  }));
}

export async function dismissAnnouncement(
  id: string,
): Promise<{ ok: true } | Err> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };
  await db.announcementDismissal
    .create({ data: { announcementId: id, userId: me.user.id } })
    .catch(() => null); // unique (announcement,user) — idempotent
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
