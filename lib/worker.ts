import "server-only";
import { redirect } from "next/navigation";
import { getMe, type MeData } from "@/app/actions/me";

/**
 * Worker-portal auth, mirroring lib/admin.ts. A WORKER is a crew member a
 * contractor invited; they get their own redacted portal at /worker and must
 * never reach the owner dashboard. `userId` is the tenancy key for their jobs
 * (JobAssignment → Worker.userId === this).
 */
export type WorkerContext = {
  me: MeData;
  userId: string;
};

/** Resolve the signed-in worker, or null (not signed in / not a worker). */
export async function getWorkerContext(): Promise<WorkerContext | null> {
  const me = await getMe();
  if (!me || me.user.role !== "WORKER") return null;
  return { me, userId: me.user.id };
}

/** Server-page/layout guard: redirect anyone who isn't a worker. */
export async function requireWorker(): Promise<WorkerContext> {
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect_url=/worker");
  if (me.user.role !== "WORKER") redirect("/dashboard");
  return { me, userId: me.user.id };
}
