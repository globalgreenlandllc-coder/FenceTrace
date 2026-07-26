/**
 * crm-insights.ts — the "smart" in the client directory. Pure functions
 * that turn a client's latest proposal state into a suggested next move,
 * so the CRM page can rank who needs attention today. No imports; safe
 * everywhere.
 */

export type ClientProposalSnapshot = {
  status: "DRAFT" | "SENT" | "VIEWED" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  sentAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type NextAction = {
  kind:
    | "finish_draft"
    | "wait"
    | "follow_up"
    | "nudge"
    | "job_running"
    | "ask_review"
    | "win_back"
    | "requote";
  label: string;
  detail: string;
  /** Badge tone the UI renders — mirrors components/ui/badge tones. */
  tone: "accent" | "neutral" | "amber" | "rose" | "sky" | "violet" | "emerald";
  /** Higher = surface first in the directory. */
  urgency: number;
};

const DAY = 24 * 60 * 60 * 1000;

function daysSince(iso: string | null, now: Date): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY));
}

/**
 * The follow-up ladder. Ordered by what closes deals: silent sent
 * proposals decay fastest, viewed-but-undecided is the hottest moment,
 * done jobs are review/referral gold.
 */
export function suggestNextAction(
  latest: ClientProposalSnapshot,
  now: Date,
): NextAction {
  const sinceSent = daysSince(latest.sentAt ?? latest.updatedAt, now);
  const sinceTouch = daysSince(latest.updatedAt, now);

  switch (latest.status) {
    case "DRAFT":
      return {
        kind: "finish_draft",
        label: "Finish & send",
        detail: "There's an unsent draft for this client.",
        tone: "violet",
        urgency: 2,
      };
    case "SENT":
      if (sinceSent >= 3) {
        return {
          kind: "follow_up",
          label: sinceSent >= 7 ? "Follow up — going cold" : "Follow up",
          detail: `Sent ${sinceSent}d ago and never opened. A quick call re-opens it.`,
          tone: sinceSent >= 7 ? "rose" : "amber",
          urgency: sinceSent >= 7 ? 5 : 4,
        };
      }
      return {
        kind: "wait",
        label: "Recently sent",
        detail: "Give them a couple of days before nudging.",
        tone: "sky",
        urgency: 1,
      };
    case "VIEWED":
      return {
        kind: "nudge",
        label: sinceTouch >= 2 ? "Nudge — they looked" : "Hot — viewed it",
        detail:
          sinceTouch >= 2
            ? `Opened the proposal ${sinceTouch}d ago but hasn't decided. Answer objections now.`
            : "They just opened it — perfect moment for a call.",
        tone: "amber",
        urgency: sinceTouch >= 2 ? 5 : 3,
      };
    case "ACCEPTED":
      if (!latest.completedAt) {
        return {
          kind: "job_running",
          label: "Job in progress",
          detail: "Keep them posted on schedule; collect on time.",
          tone: "accent",
          urgency: 2,
        };
      }
      return {
        kind: "ask_review",
        label: "Ask for a review",
        detail: "Job's done and paid — best time to ask for a review or referral.",
        tone: "emerald",
        urgency: 3,
      };
    case "DECLINED":
      return {
        kind: "win_back",
        label: "Win-back",
        detail: "They said no — ask what number would have worked.",
        tone: "rose",
        urgency: 2,
      };
    case "EXPIRED":
      return {
        kind: "requote",
        label: "Re-quote",
        detail: "The proposal expired. Refresh pricing and resend.",
        tone: "neutral",
        urgency: 2,
      };
  }
}
