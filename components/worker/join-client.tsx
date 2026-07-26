"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HardHat, Check, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptWorkerInvite } from "@/app/actions/worker-jobs";

export function JoinClient({ token }: { token: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function accept() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    const r = await acceptWorkerInvite(token);
    if (!r.ok) {
      setBusy(false);
      return setErr(r.reason);
    }
    // Role is now WORKER — go to the portal (full nav so the guarded page loads).
    router.push("/worker");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="surface anim-enter rounded-2xl border border-zinc-200 bg-white p-6 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-600 text-white">
          <HardHat className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-ink">Join the crew</h1>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-zinc-500">
          Accept to link this account and start seeing the jobs your contractor assigns you — schedule, address, what to do, and your pay.
        </p>

        {!token && (
          <div className="anim-enter mt-5 flex items-center justify-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4" /> This link is missing its invite token.
          </div>
        )}
        {err && (
          <div className="anim-enter mt-5 flex items-center justify-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4" /> {err}
          </div>
        )}

        <Button className="mt-6 w-full" onClick={accept} disabled={busy || !token}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Accept invite
        </Button>
      </div>
    </div>
  );
}
