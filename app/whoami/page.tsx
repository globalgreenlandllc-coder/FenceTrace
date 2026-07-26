import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Diagnostic page — accessible to any signed-in user. Shows exactly what
 * the server sees so we can debug "why am I not super admin?" without
 * guessing. Safe to ship: the only secret-ish data shown is the Clerk
 * email, which the user already knows.
 */
export default async function WhoAmIPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/whoami");
  }

  const clerkUser = await currentUser();
  const primaryEmail =
    clerkUser?.emailAddresses.find(
      (e) => e.id === clerkUser?.primaryEmailAddressId,
    )?.emailAddress ??
    clerkUser?.emailAddresses[0]?.emailAddress ??
    null;

  const allClerkEmails = (clerkUser?.emailAddresses ?? []).map(
    (e) => e.emailAddress,
  );

  const rawAdminEmails = process.env.ADMIN_EMAILS ?? "";
  const adminList = rawAdminEmails
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const matched = primaryEmail
    ? adminList.includes(primaryEmail.trim().toLowerCase())
    : false;

  const dbUser = await db.user.findFirst({
    where: { OR: [{ clerkId }, ...(primaryEmail ? [{ email: primaryEmail }] : [])] },
    select: {
      id: true,
      clerkId: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 font-mono text-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        whoami diagnostic
      </h1>
      <p className="mt-1 text-xs text-zinc-500">
        Snapshot of how the server sees you right now. If <code>match</code> is
        true and your role is still CONTRACTOR, refresh this page once — the
        next request will auto-promote you.
      </p>

      <Section title="Clerk identity">
        <Row label="clerkId" value={clerkId} />
        <Row label="primaryEmail" value={primaryEmail ?? "(none)"} />
        <Row
          label="allEmails"
          value={
            allClerkEmails.length > 0 ? allClerkEmails.join(", ") : "(none)"
          }
        />
      </Section>

      <Section title="ADMIN_EMAILS env">
        <Row label="raw" value={rawAdminEmails || "(empty)"} />
        <Row
          label="parsed"
          value={
            adminList.length > 0
              ? `[${adminList.map((e) => `"${e}"`).join(", ")}]`
              : "[]"
          }
        />
        <Row
          label="match"
          value={matched ? "✅ true (will promote)" : "❌ false"}
          tone={matched ? "ok" : "bad"}
        />
      </Section>

      <Section title="Database">
        {dbUser ? (
          <>
            <Row label="user.id" value={dbUser.id} />
            <Row label="user.email" value={dbUser.email} />
            <Row
              label="user.clerkId"
              value={dbUser.clerkId ?? "(null — first sign-in not completed)"}
            />
            <Row
              label="user.role"
              value={dbUser.role}
              tone={dbUser.role === "SUPER_ADMIN" ? "ok" : "warn"}
            />
            <Row label="user.status" value={dbUser.status} />
            <Row
              label="lastLoginAt"
              value={
                dbUser.lastLoginAt
                  ? dbUser.lastLoginAt.toISOString()
                  : "(never)"
              }
            />
          </>
        ) : (
          <Row
            label="status"
            value="No DB row yet — visit /dashboard once to provision"
            tone="warn"
          />
        )}
      </Section>

      <Section title="Diagnosis">
        <Diagnosis
          matched={matched}
          dbRole={dbUser?.role ?? null}
          adminListEmpty={adminList.length === 0}
        />
      </Section>

      <div className="mt-8 flex gap-2 text-xs">
        <a
          href="/dashboard"
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-700 hover:border-zinc-300"
        >
          Dashboard
        </a>
        <a
          href="/admin"
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-700 hover:border-zinc-300"
        >
          Try /admin
        </a>
        <a
          href="/whoami"
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-700 hover:border-zinc-300"
        >
          Refresh
        </a>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface mt-6 p-4 shadow-card">
      <div className="font-label text-[11px] text-zinc-400">
        {title}
      </div>
      <div className="mt-2 space-y-1">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const color =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-rose-700"
        : tone === "warn"
          ? "text-amber-700"
          : "text-zinc-900";
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2">
      <span className="text-zinc-500">{label}</span>
      <span className={`break-all ${color}`}>{value}</span>
    </div>
  );
}

function Diagnosis({
  matched,
  dbRole,
  adminListEmpty,
}: {
  matched: boolean;
  dbRole: string | null;
  adminListEmpty: boolean;
}) {
  if (adminListEmpty) {
    return (
      <p className="text-rose-700">
        ADMIN_EMAILS is empty on this deployment. Set it in Vercel → Settings →
        Environment Variables (Production), then redeploy.
      </p>
    );
  }
  if (!matched) {
    return (
      <p className="text-rose-700">
        Your Clerk email isn't in the parsed ADMIN_EMAILS list. Check spelling
        and casing in Vercel — the comparison is case-insensitive but exact
        otherwise. Note: <code>globalgreenlandllc</code> has two `r`s.
      </p>
    );
  }
  if (dbRole === "SUPER_ADMIN") {
    return (
      <p className="text-emerald-700">
        ✅ Everything's correct — you should see the admin sidebar entry on
        /dashboard. If you don't, hard-refresh the page (Cmd-Shift-R).
      </p>
    );
  }
  return (
    <p className="text-amber-700">
      Email matches but DB role hasn't flipped yet. Refresh this page once —
      getMe() runs on every request and will update the role. If it still
      doesn't change, the deployment may be running stale env vars; redeploy
      from Vercel.
    </p>
  );
}
