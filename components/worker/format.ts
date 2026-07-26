import type { JobAssignmentStatus } from "@prisma/client";

export const fmtMoney = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export const fmtShortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export const STATUS_META: Record<
  JobAssignmentStatus,
  { label: string; tone: "accent" | "emerald" | "amber" | "rose" | "neutral" | "sky" }
> = {
  OFFERED: { label: "New offer", tone: "amber" },
  ACCEPTED: { label: "Accepted", tone: "emerald" },
  IN_PROGRESS: { label: "In progress", tone: "sky" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  DECLINED: { label: "Declined", tone: "rose" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};
