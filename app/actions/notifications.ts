"use server";

import { db } from "@/lib/db";
import { getMe } from "./me";

/**
 * notifications.ts — the bell counts. Deliberately schema-free: "unread"
 * is derived from ticket status + announcement dismissals, so there's no
 * seen-timestamp to maintain.
 *   - user support reply waiting  = their PENDING tickets (admin replied,
 *     they haven't responded); clears when they reply or it's resolved.
 *   - user announcements          = published, audience-matched, undismissed.
 *   - admin open tickets          = tickets awaiting the admin (not resolved,
 *     last message not from admin).
 */

export type BellCounts = {
  /** For every signed-in user: support replies + fresh announcements. */
  support: number;
  announcements: number;
  /** Admin only: tickets waiting on the admin. 0 for non-admins. */
  adminTickets: number;
};

export async function getBellCounts(): Promise<BellCounts> {
  const me = await getMe();
  if (!me) return { support: 0, announcements: 0, adminTickets: 0 };

  const roleAudiences =
    me.user.role === "WORKER"
      ? (["ALL", "WORKERS"] as const)
      : (["ALL", "CONTRACTORS"] as const);

  const [support, announcements, adminTickets] = await Promise.all([
    db.supportTicket.count({
      where: { userId: me.user.id, status: "PENDING" },
    }),
    db.announcement.count({
      where: {
        publishedAt: { not: null },
        audience: { in: [...roleAudiences] },
        dismissals: { none: { userId: me.user.id } },
      },
    }),
    me.user.role === "SUPER_ADMIN"
      ? db.supportTicket.count({
          where: { status: { not: "RESOLVED" }, lastFromAdmin: false },
        })
      : Promise.resolve(0),
  ]);

  return { support, announcements, adminTickets };
}
