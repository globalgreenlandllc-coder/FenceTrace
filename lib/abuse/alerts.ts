import "server-only";
import { sendEmailViaResend } from "@/lib/email/resend";
import { POLICIES } from "./policies";
import { logAbuseEvent, tryConsumeQuiet } from "./rate-limit";

// Admin alerting for abuse / spend anomalies. Reuses the existing
// Resend chokepoint (with the abuse guard bypassed — an email flood
// exhausting the global cap must never silence the alert about it) and
// ADMIN_EMAILS, the same env that drives SUPER_ADMIN elevation.
//
// Throttled to one email per alertKey per hour via the same limiter,
// so a runaway loop produces one email, not one per request.

export async function alertAdmins(args: {
  /** Stable dedupe key, e.g. "circuit-open", "spend-80pct", "email-global-cap". */
  alertKey: string;
  subject: string;
  lines: string[];
}): Promise<void> {
  try {
    const recipients = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.includes("@"));
    if (recipients.length === 0) {
      console.warn(`[abuse-alert] ${args.alertKey}: ADMIN_EMAILS unset — alert only logged`);
      await logAbuseEvent({
        kind: "ALERT_SENT",
        policy: args.alertKey,
        scopeKey: "global",
        detail: { subject: args.subject, lines: args.lines, delivered: false },
      });
      return;
    }

    // One email per alert kind per hour. If the throttle check itself
    // fails (DB down), still send — noisy beats silent here.
    const fresh = await tryConsumeQuiet(POLICIES.alertThrottle, `alert:${args.alertKey}`);
    if (!fresh) return;

    const text = args.lines.join("\n");
    const html = `<div style="font-family:ui-monospace,monospace;font-size:14px;line-height:1.6">${args.lines
      .map((l) => escapeHtml(l))
      .join("<br/>")}</div>`;

    for (const to of recipients) {
      await sendEmailViaResend({
        to,
        fromName: "FenceTrace Abuse Guard",
        subject: `[FenceTrace] ${args.subject}`,
        html,
        text,
        skipAbuseGuard: true,
      });
    }

    await logAbuseEvent({
      kind: "ALERT_SENT",
      policy: args.alertKey,
      scopeKey: "global",
      detail: { subject: args.subject, recipients: recipients.length },
    });
  } catch (e) {
    // Alerting must never take down the request that triggered it.
    console.error(`[abuse-alert] ${args.alertKey} failed`, e);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
