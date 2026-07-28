import "server-only";
import { getActiveApiKey } from "@/lib/api-keys";
import { consumeLimit, logAbuseEvent } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";

export type SendEmailArgs = {
  to: string;
  fromName: string;
  /** Plain "Reply-To" address — homeowner replies go straight to the contractor. */
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Bypass the per-recipient / global send caps. ONLY for internal
   * admin alert mail (lib/abuse/alerts.ts) — an email flood exhausting
   * the global cap must never silence the alert about the flood.
   */
  skipAbuseGuard?: boolean;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

/**
 * Sends a transactional email via Resend using the API key from the vault.
 *
 * "From" address: we use Resend's verified sandbox sender by default
 * (`onboarding@resend.dev`) so this works the moment a key is added — no
 * domain DNS config required. Production deployments can override the
 * sender by setting RESEND_FROM_EMAIL to a verified address on their own
 * domain (e.g. proposals@yourfenceco.com).
 */
export async function sendEmailViaResend(
  args: SendEmailArgs,
): Promise<SendEmailResult> {
  // Chokepoint abuse caps: EVERY email in the app flows through this
  // function, including the ones triggered by unauthenticated portal
  // actions (proposal accept, change-order response) and cron. Two
  // fail-open caps: per-recipient/day (one homeowner can't be spammed)
  // and platform-wide/day (a bot loop can't torch sender reputation or
  // the Resend bill). Per-USER caps live at the action layer, where the
  // sender's identity is known.
  if (!args.skipAbuseGuard) {
    const recipientKey = `rcpt:${args.to.trim().toLowerCase()}`;
    const [rcpt, global] = await Promise.all([
      consumeLimit({ policy: POLICIES.emailRecipient, key: recipientKey }),
      consumeLimit({ policy: POLICIES.emailGlobal, key: "global" }),
    ]);
    if (!rcpt.ok || !global.ok) {
      if (!global.ok) {
        await logAbuseEvent({
          kind: "QUOTA_EXCEEDED",
          policy: POLICIES.emailGlobal.name,
          scopeKey: "global",
          detail: { to: args.to, subject: args.subject },
        });
        // Dynamic import dodges the resend↔alerts module cycle.
        const { alertAdmins } = await import("@/lib/abuse/alerts");
        await alertAdmins({
          alertKey: "email-global-cap",
          subject: "🚨 Platform-wide daily email cap reached — sending paused",
          lines: [
            "The global daily email cap was reached; further sends are refused until the window resets.",
            "If this is a bot/abuse event, check /admin/abuse for the trigger.",
            "If it's legitimate growth, raise ABUSE_LIMIT_EMAIL_GLOBAL.",
          ],
        });
      }
      return {
        ok: false,
        reason: !global.ok ? POLICIES.emailGlobal.message : POLICIES.emailRecipient.message,
      };
    }
  }

  const key = await getActiveApiKey("RESEND");
  if (!key) {
    return { ok: false, reason: "Resend key not configured in /admin/api-keys" };
  }

  const fromAddress =
    process.env.RESEND_FROM_EMAIL?.trim() || "onboarding@resend.dev";
  const from = `${escapeFromName(args.fromName)} <${fromAddress}>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        reply_to: args.replyTo ? [args.replyTo] : undefined,
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
      cache: "no-store",
    });

    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        reason:
          body.message ?? body.name ?? `Resend HTTP ${res.status}`,
      };
    }
    if (!body.id) {
      return { ok: false, reason: "Resend returned no message id" };
    }
    return { ok: true, id: body.id };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Resend network error",
    };
  }
}

/**
 * Strip characters that would break the RFC-5322 display-name slot. Resend
 * is strict — an unescaped quote or angle bracket here will 422 the request.
 */
function escapeFromName(name: string): string {
  const cleaned = name.replace(/["<>]/g, "").trim();
  return cleaned.length > 0 ? cleaned : "FenceScan";
}
