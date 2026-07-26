import "server-only";
import { consumeLimit, getClientIp, type LimitDecision } from "./rate-limit";
import { POLICIES, type Policy } from "./policies";

// Thin composition helpers so action files wire a guard in one line.

/**
 * Per-user budget for contractor-initiated email (proposal sends,
 * reminders, receipts, invites). The chokepoint caps in resend.ts are
 * the platform-wide backstop; this attributes the limit to the sender.
 */
export async function checkUserEmailBudget(
  userId: string,
  route: string,
): Promise<LimitDecision> {
  return consumeLimit({
    policy: POLICIES.emailUser,
    key: `user:${userId}`,
    context: { userId, route },
  });
}

/**
 * Guard for UNAUTHENTICATED portal writes (/p/[token] accept +
 * change-order respond): per-token limit plus a cross-token per-IP
 * limit, so neither a stolen link nor one bot IP can loop the write.
 * Fail-open by policy — a homeowner accepting a real proposal beats
 * a limiter blip.
 */
export async function checkPortalWrite(
  policy: Policy,
  token: string,
  route: string,
): Promise<LimitDecision> {
  const ip = await getClientIp();
  if (ip) {
    const byIp = await consumeLimit({
      policy: POLICIES.portalIp,
      key: `ip:${ip}`,
      context: { ip, route },
    });
    if (!byIp.ok) return byIp;
  }
  return consumeLimit({
    policy,
    key: `token:${token}`,
    context: { ip: ip ?? undefined, route },
  });
}
