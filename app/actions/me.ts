"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getPlanPricing } from "@/lib/plan-pricing";
import {
  IMPERSONATION_MAX_AGE_MS,
  clearImpersonationCookie,
  readImpersonationSessionId,
} from "@/lib/impersonation";
import type {
  ContractorProfile,
  Credits,
  LogoTone,
} from "@/lib/auth-mock";

export type Impersonation = {
  sessionId: string;
  adminUserId: string;
  adminEmail: string;
  startedAt: string;
  reason: string | null;
};

export type MeData = {
  user: {
    id: string;
    clerkId: string;
    email: string;
    name: string;
    role: "CONTRACTOR" | "WORKER" | "SUPER_ADMIN";
    status: "ACTIVE" | "SUSPENDED";
  };
  profile: ContractorProfile;
  credits: Credits;
  impersonation?: Impersonation;
};

// Subscription statuses that get PRO wallet semantics (monthly credit
// refresh). PAST_DUE is deliberately excluded from the refresh but also
// from the free-plan regrade — a card hiccup shouldn't wipe the wallet;
// the Stripe webhook resolves it either way within days.
const REFRESHING_STATUSES = new Set(["ACTIVE", "TRIALING"]);

function nextMonthBoundary(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0),
  );
}

function deriveContractorName(
  fullName: string | null,
  email: string,
): string {
  if (fullName && fullName.trim().length > 0) return fullName.trim();
  const local = email.split("@")[0] ?? "Contractor";
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

function deriveInitials(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .filter(Boolean);
  if (parts.length === 0) return "FT";
  return parts.slice(0, 2).join("");
}

const TONES_CYCLE: LogoTone[] = [
  "emerald",
  "sky",
  "indigo",
  "amber",
  "rose",
  "violet",
];

function pickTone(seed: string): LogoTone {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return TONES_CYCLE[hash % TONES_CYCLE.length];
}

function isAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

type DbUserWithRelations = NonNullable<
  Awaited<ReturnType<typeof findOrCreateUser>>
>;

async function findOrCreateUser(
  clerkId: string,
  email: string,
  fullName: string | null,
) {
  const targetRole = isAdminEmail(email) ? "SUPER_ADMIN" : "CONTRACTOR";

  let user = await db.user.findFirst({
    where: { OR: [{ clerkId }, { email }] },
    include: {
      contractorProfile: true,
      creditWallet: true,
      subscription: { select: { status: true } },
    },
  });

  if (!user) {
    const contractorName = deriveContractorName(fullName, email);
    const initials = deriveInitials(contractorName);
    const tone = pickTone(clerkId);
    // New accounts start on the free plan: a one-time blueprint-takeoff
    // allowance (address estimates don't touch the wallet at all).
    const included = (await getPlanPricing()).free.blueprintCredits;
    user = await db.user.create({
      data: {
        clerkId,
        email,
        name: fullName,
        role: targetRole,
        lastLoginAt: new Date(),
        contractorProfile: {
          create: {
            company: contractorName,
            contractorName,
            email,
            phone: "",
            license: "",
            tagline: "",
            logoInitials: initials,
            logoTone: tone,
          },
        },
        creditWallet: {
          create: {
            included,
            used: 0,
            bonus: 0,
            resetsAt: nextMonthBoundary(),
          },
        },
      },
      include: {
        contractorProfile: true,
        creditWallet: true,
        subscription: { select: { status: true } },
      },
    });
    await attributeReferral(user.id);
    return user;
  }

  // Only SUPER_ADMIN is env-driven (ADMIN_EMAILS). A promoted WORKER role must
  // be PRESERVED — a worker is flipped to WORKER when they accept an invite, and
  // this every-request sync must not clobber that back to CONTRACTOR.
  const desiredRole = isAdminEmail(email)
    ? "SUPER_ADMIN"
    : user.role === "WORKER"
      ? "WORKER"
      : "CONTRACTOR";

  const updates: Record<string, unknown> = { lastLoginAt: new Date() };
  if (user.clerkId !== clerkId) updates.clerkId = clerkId;
  if (user.email !== email) updates.email = email;
  if (user.role !== desiredRole) updates.role = desiredRole;
  await db.user.update({ where: { id: user.id }, data: updates });

  if (!user.contractorProfile) {
    const contractorName = deriveContractorName(user.name ?? fullName, email);
    const initials = deriveInitials(contractorName);
    const tone = pickTone(clerkId);
    await db.contractorProfile.create({
      data: {
        userId: user.id,
        company: contractorName,
        contractorName,
        email,
        phone: "",
        license: "",
        tagline: "",
        logoInitials: initials,
        logoTone: tone,
      },
    });
  }
  const subStatus = user.subscription?.status ?? null;
  const isRefreshingSub = subStatus !== null && REFRESHING_STATUSES.has(subStatus);

  if (!user.creditWallet) {
    await db.creditWallet.create({
      data: {
        userId: user.id,
        included: (await getPlanPricing()).free.blueprintCredits,
        used: 0,
        bonus: 0,
        resetsAt: nextMonthBoundary(),
      },
    });
  } else if (isRefreshingSub && user.creditWallet.resetsAt.getTime() < Date.now()) {
    // PRO lazy monthly rollover — fallback for a missed invoice.paid
    // webhook. `included` refreshes (used → 0) and re-syncs to the
    // current admin-configured allowance (otherwise a /admin/pricing
    // edit would never reach existing subscribers); purchased `bonus`
    // credits carry over minus whatever the user already burned beyond
    // the monthly allowance. The updateMany guard on resetsAt makes
    // concurrent requests idempotent (only one resets).
    const cw = user.creditWallet;
    const included = (await getPlanPricing()).pro.includedCredits;
    const overflowUsed = Math.max(0, cw.used - cw.included);
    await db.creditWallet.updateMany({
      where: { userId: user.id, resetsAt: cw.resetsAt },
      data: {
        included,
        used: 0,
        bonus: Math.max(0, cw.bonus - overflowUsed),
        resetsAt: nextMonthBoundary(),
      },
    });
  } else if (!isRefreshingSub && subStatus !== "PAST_DUE") {
    // FREE plan (no sub / CANCELED / INCOMPLETE): the wallet holds the
    // one-time blueprint allowance and never renews. One-shot regrade
    // whenever `included` disagrees with the configured free allowance:
    //   - legacy wallets from the everyone-gets-12 era,
    //   - just-canceled subscribers dropping off Pro,
    //   - an /admin/pricing edit to the free allowance.
    // `used` resets with it (pre-regrade `used` counted address scans,
    // which are free now); purchased bonus credits always survive. The
    // updateMany guard on `included` keeps concurrent requests idempotent.
    // PAST_DUE is left untouched — Stripe retries resolve it either way.
    const cw = user.creditWallet;
    const freeIncluded = (await getPlanPricing()).free.blueprintCredits;
    if (cw.included !== freeIncluded) {
      await db.creditWallet.updateMany({
        where: { userId: user.id, included: cw.included },
        data: { included: freeIncluded, used: 0 },
      });
    }
  }

  return db.user.findUnique({
    where: { id: user.id },
    include: {
      contractorProfile: true,
      creditWallet: true,
      subscription: { select: { status: true } },
    },
  });
}

function shape(
  user: DbUserWithRelations,
  clerkId: string,
  fallbackEmail: string,
  fallbackName: string | null,
  impersonation?: Impersonation,
): MeData {
  const cp = user.contractorProfile;
  const cw = user.creditWallet;
  const subStatus = user.subscription?.status ?? null;
  const renews = subStatus !== null && REFRESHING_STATUSES.has(subStatus);
  return {
    user: {
      id: user.id,
      clerkId,
      email: user.email,
      name: fallbackName ?? cp?.contractorName ?? user.email,
      role: user.role as "CONTRACTOR" | "SUPER_ADMIN",
      status: user.status as "ACTIVE" | "SUSPENDED",
    },
    profile: {
      company: cp?.company ?? "",
      contractorName: cp?.contractorName ?? "",
      email: cp?.email ?? user.email,
      phone: cp?.phone ?? "",
      license: cp?.license ?? "",
      tagline: cp?.tagline ?? "",
      logo: {
        initials: cp?.logoInitials ?? deriveInitials(cp?.company || ""),
        tone: (cp?.logoTone as LogoTone) ?? "emerald",
        url: cp?.logoUrl ?? null,
      },
      payments: {
        stripeUrl: cp?.stripePaymentUrl ?? null,
        squareUrl: cp?.squarePaymentUrl ?? null,
      },
    },
    credits: {
      included: cw?.included ?? 1,
      used: cw?.used ?? 0,
      bonus: cw?.bonus ?? 0,
      resetsAt: (cw?.resetsAt ?? nextMonthBoundary()).toISOString(),
      renews,
    },
    impersonation,
  };
}

export async function getMe(): Promise<MeData | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  // FAST PATH — getMe runs at the top of nearly every server action, so
  // its cost multiplies across the whole app. auth() is a local JWT
  // check; the expensive parts were currentUser() (a Clerk Backend API
  // round trip) and findOrCreateUser's unconditional lastLoginAt write.
  // A returning user resolves with ONE indexed read; Clerk is only
  // consulted on first login, when the row doesn't exist yet.
  let adminUser = await db.user.findFirst({
    where: { clerkId },
    include: {
      contractorProfile: true,
      creditWallet: true,
      subscription: { select: { status: true } },
    },
  });

  if (adminUser) {
    // Role stays env-driven without a network call: ADMIN_EMAILS is a
    // string compare. WORKER promotion is preserved (see findOrCreateUser).
    const desiredRole = isAdminEmail(adminUser.email)
      ? "SUPER_ADMIN"
      : adminUser.role === "WORKER"
        ? "WORKER"
        : "CONTRACTOR";
    if (adminUser.role !== desiredRole) {
      adminUser = await db.user.update({
        where: { id: adminUser.id },
        data: { role: desiredRole },
        include: {
          contractorProfile: true,
          creditWallet: true,
          subscription: { select: { status: true } },
        },
      });
    }
    // lastLoginAt powers admin analytics, not auth — hourly resolution
    // is plenty, and fire-and-forget keeps it off the request's clock.
    const last = adminUser.lastLoginAt?.getTime() ?? 0;
    if (Date.now() - last > 60 * 60 * 1000) {
      void db.user
        .update({ where: { id: adminUser.id }, data: { lastLoginAt: new Date() } })
        .catch(() => undefined);
    }
  } else {
    // First login (or a pre-created row linked by email): the full
    // Clerk lookup + create/sync path, exactly as before.
    const clerkUser = await currentUser();
    if (!clerkUser) return null;

    const email =
      clerkUser.emailAddresses.find(
        (e) => e.id === clerkUser.primaryEmailAddressId,
      )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
    if (!email) return null;

    const fullName =
      clerkUser.fullName ||
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      null;

    adminUser = await findOrCreateUser(clerkId, email, fullName);
  }
  if (!adminUser) return null;

  if (adminUser.role === "SUPER_ADMIN") {
    const sessionId = await readImpersonationSessionId();
    if (sessionId) {
      const session = await db.impersonationSession.findUnique({
        where: { id: sessionId },
        include: {
          admin: true,
          user: {
            include: {
              contractorProfile: true,
              creditWallet: true,
              subscription: { select: { status: true } },
            },
          },
        },
      });
      const valid =
        session &&
        !session.endedAt &&
        session.adminId === adminUser.id &&
        Date.now() - session.startedAt.getTime() < IMPERSONATION_MAX_AGE_MS &&
        session.user.role !== "SUPER_ADMIN";

      if (valid) {
        return shape(
          session.user,
          session.user.clerkId ?? "",
          session.user.email,
          session.user.name,
          {
            sessionId: session.id,
            adminUserId: session.adminId,
            adminEmail: session.admin.email,
            startedAt: session.startedAt.toISOString(),
            reason: session.reason,
          },
        );
      }
      await clearImpersonationCookie();
    }
  }

  // The DB row is the identity of record (synced from Clerk at creation
  // and on role changes) — the fast path never fetched Clerk's copy.
  return shape(adminUser, clerkId, adminUser.email, adminUser.name);
}

export async function updateMyProfile(
  patch: Partial<ContractorProfile>,
): Promise<MeData | null> {
  const me = await getMe();
  if (!me) return null;

  const data: Record<string, unknown> = {};
  if (patch.company !== undefined) data.company = patch.company;
  if (patch.contractorName !== undefined)
    data.contractorName = patch.contractorName;
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.phone !== undefined) data.phone = patch.phone;
  if (patch.license !== undefined) data.license = patch.license;
  if (patch.tagline !== undefined) data.tagline = patch.tagline;
  if (patch.logo?.initials !== undefined)
    data.logoInitials = patch.logo.initials;
  if (patch.logo?.tone !== undefined) data.logoTone = patch.logo.tone;
  if (patch.logo?.url !== undefined) {
    data.logoUrl = validateLogoUrl(patch.logo.url);
  }
  if (patch.payments?.stripeUrl !== undefined) {
    data.stripePaymentUrl = validatePaymentUrl(patch.payments.stripeUrl, "stripe");
  }
  if (patch.payments?.squareUrl !== undefined) {
    data.squarePaymentUrl = validatePaymentUrl(patch.payments.squareUrl, "square");
  }

  await db.contractorProfile.update({
    where: { userId: me.user.id },
    data,
  });

  return getMe();
}

const ALLOWED_LOGO_PREFIXES = [
  "data:image/png;",
  "data:image/jpeg;",
  "data:image/webp;",
  "data:image/svg+xml;",
];
const MAX_LOGO_DATAURL_BYTES = 600_000;

function validateLogoUrl(url: string | null): string | null {
  if (url === null || url === "") return null;
  if (typeof url !== "string") {
    throw new Error("Logo must be a string");
  }
  if (url.length > MAX_LOGO_DATAURL_BYTES) {
    throw new Error(
      `Logo too large (${Math.round(url.length / 1024)} KB). Max ~450 KB binary.`,
    );
  }
  if (!ALLOWED_LOGO_PREFIXES.some((p) => url.startsWith(p))) {
    throw new Error(
      "Unsupported image format. Use PNG, JPEG, WebP, or SVG.",
    );
  }
  return url;
}

// The client portal renders these links as "Pay with Stripe / Square",
// so they must actually point at those providers — an arbitrary https
// URL under that label would be a phishing surface on the proposal page.
const PAYMENT_LINK_DOMAINS: Record<"stripe" | "square", string[]> = {
  stripe: ["stripe.com"],
  square: ["square.link", "squareup.com", "square.site"],
};

function validatePaymentUrl(
  url: string | null,
  provider: "stripe" | "square",
): string | null {
  if (url === null) return null;
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (trimmed.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Payment link must be a valid URL (https://…).");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Payment link must use https://");
  }
  if (trimmed.length > 2048) {
    throw new Error("Payment link is too long.");
  }
  const host = parsed.hostname.toLowerCase();
  const ok = PAYMENT_LINK_DOMAINS[provider].some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
  if (!ok) {
    throw new Error(
      provider === "stripe"
        ? "Stripe link must be a stripe.com URL (e.g. https://buy.stripe.com/…)."
        : "Square link must be a Square URL (e.g. https://square.link/u/… or https://checkout.square.site/…).",
    );
  }
  return parsed.toString();
}

export async function consumeMyCredit(address: string): Promise<{
  ok: boolean;
  reused: boolean;
  remaining: number;
  reason?: string;
}> {
  const me = await getMe();
  if (!me) return { ok: false, reused: false, remaining: 0, reason: "Not signed in" };

  const userId = me.user.id;
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const norm = address.trim().toLowerCase();
  // Address estimates are FREE on every plan — the wallet only meters
  // blueprint takeoffs now. This legacy entry point (mock pathway) still
  // logs the run and enforces the per-address daily cap, but never
  // debits. `remaining` reports the blueprint-credit balance for display.
  const isAdmin = me.user.role === "SUPER_ADMIN";
  const remaining = isAdmin
    ? Number.POSITIVE_INFINITY
    : Math.max(me.credits.included + me.credits.bonus - me.credits.used, 0);

  const recentSame = await db.estimateRun.count({
    where: {
      userId,
      addressNormalized: norm,
      createdAt: { gte: since },
    },
  });

  if (!isAdmin && recentSame >= 10) {
    return {
      ok: false,
      reused: false,
      remaining,
      reason: "Same address has been re-run 10 times in the last 24 hours.",
    };
  }

  await db.estimateRun.create({
    data: {
      userId,
      address,
      addressNormalized: norm,
      status: "SUCCEEDED",
      creditConsumed: false,
      reused: recentSame > 0,
    },
  });

  return { ok: true, reused: recentSame > 0, remaining };
}

/* ------------------------------------------------------------------ */
/*  Referral program                                                   */
/*                                                                     */
/*  Contractors know contractors. Each user gets a shareable link      */
/*  (/?ref=<code>, cookied for 30 days by the middleware); when a new  */
/*  account is created with that cookie present, the referrer's wallet */
/*  earns bonus blueprint credits. referredById doubles as the         */
/*  "already credited" marker, and grants stop at the cap so a bot     */
/*  farm can't mint unlimited credits.                                 */
/* ------------------------------------------------------------------ */

const REFERRAL_COOKIE = "fencescan_ref";
const REFERRAL_BONUS_CREDITS = 3;
const REFERRAL_GRANT_CAP = 10;

/** Best-effort, called exactly once per new account. Never throws into
 *  the signup path — a broken referral must not block account creation. */
async function attributeReferral(newUserId: string): Promise<void> {
  try {
    const jar = await cookies();
    const refCode = jar.get(REFERRAL_COOKIE)?.value?.trim();
    if (!refCode || !/^[a-f0-9]{8}$/i.test(refCode)) return;
    const referrer = await db.user.findFirst({
      where: { referralCode: refCode },
      select: { id: true },
    });
    if (!referrer || referrer.id === newUserId) return;
    const credited = await db.user.count({
      where: { referredById: referrer.id },
    });
    if (credited >= REFERRAL_GRANT_CAP) return;
    await db.user.update({
      where: { id: newUserId },
      data: { referredById: referrer.id },
    });
    // updateMany: no throw when the referrer's wallet row doesn't exist
    // yet (it's lazily created on their next visit — rare, acceptable).
    await db.creditWallet.updateMany({
      where: { userId: referrer.id },
      data: { bonus: { increment: REFERRAL_BONUS_CREDITS } },
    });
  } catch (e) {
    console.warn("[referral] attribution failed", e);
  }
}

export type MyReferral = {
  code: string;
  url: string;
  credited: number;
  cap: number;
  bonusPerSignup: number;
};

/** Settings-page read: lazily mints the user's referral code. */
export async function getMyReferral(): Promise<MyReferral | null> {
  const me = await getMe();
  if (!me) return null;
  const row = await db.user.findUnique({
    where: { id: me.user.id },
    select: { referralCode: true },
  });
  let code = row?.referralCode ?? null;
  if (!code) {
    for (let attempt = 0; attempt < 2 && !code; attempt++) {
      const candidate = randomBytes(4).toString("hex");
      try {
        await db.user.update({
          where: { id: me.user.id },
          data: { referralCode: candidate },
        });
        code = candidate;
      } catch {
        // unique collision (1 in 4 billion) — try once more
      }
    }
    if (!code) return null;
  }
  const credited = await db.user.count({
    where: { referredById: me.user.id },
  });
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    "https://fencescan.com";
  return {
    code,
    url: `${base}/?ref=${code}`,
    credited,
    cap: REFERRAL_GRANT_CAP,
    bonusPerSignup: REFERRAL_BONUS_CREDITS,
  };
}
