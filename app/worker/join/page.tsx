import { JoinClient } from "@/components/worker/join-client";

// No requireWorker here — a person accepting their FIRST invite is still a
// CONTRACTOR until acceptWorkerInvite flips them. Middleware already requires a
// signed-in Clerk session to reach this route.
export default async function WorkerJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <JoinClient token={token ?? null} />;
}
