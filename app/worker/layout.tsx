import { getMe } from "@/app/actions/me";
import { WorkerShell } from "@/components/worker/worker-shell";

// Chrome only — NO role guard here, so a not-yet-worker can reach /worker/join
// to accept their invite. The data pages (page.tsx, jobs/[id], schedule) each
// call requireWorker() themselves.
export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  return <WorkerShell name={me?.user.name ?? null}>{children}</WorkerShell>;
}
