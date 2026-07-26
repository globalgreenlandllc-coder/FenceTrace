// Shared types + helpers used by the contractor dashboard.
// The dashboard pulls real data from app/actions/dashboard.ts; only the
// type aliases and timeAgo helper live here now.

export type ProposalStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "accepted"
  | "declined"
  | "expired";

export type ProposalListItem = {
  id: string;
  address: string;
  client: string;
  clientEmail?: string;
  total: number;
  status: ProposalStatus;
  selectedPackage?: string;
  updatedAt: string;
  /** Total ProposalEvent rows of any kind. Kept for backwards-compat. */
  views: number;
  /** ProposalEvent rows with kind=VIEWED (i.e. client opened the portal). */
  viewCount: number;
  /** Most recent VIEWED event timestamp (ISO), if any. */
  lastViewedAt?: string;
  /** First VIEWED event timestamp (ISO), if any. */
  firstViewedAt?: string;
  paid?: number;
  /** Payment tracking (accepted jobs). Dollars, mirroring `total`. */
  paidTotal?: number;
  /** ISO timestamp when the job hit 100% collected → "Done jobs". */
  completedAt?: string;
  /** Change orders sitting with the client (status SENT). */
  pendingChangeOrders?: number;
  /** Overdue pending installments (due date in the past). */
  overdueInstallments?: number;
  /** Live price negotiations (status OPEN or COUNTERED). */
  openDiscountRequests?: number;
  /** A live price request is waiting on the contractor to respond. */
  discountNeedsResponse?: boolean;
};

/** Derived job stage for accepted proposals: collecting vs fully paid. */
export function jobStage(p: ProposalListItem): "in_progress" | "done" | null {
  if (p.status !== "accepted") return null;
  return p.completedAt ? "done" : "in_progress";
}

export type ActivityEvent = {
  id: string;
  kind:
    | "viewed"
    | "accepted"
    | "paid"
    | "sent"
    | "drafted"
    | "expired"
    | "declined";
  client: string;
  proposalId: string;
  message: string;
  at: string;
};

export type Kpis = {
  sent: number;
  accepted: number;
  revenueMtd: number;
  conversion: number;
  pipelineValue: number;
  avgDeal: number;
};

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
