import { requireWorker } from "@/lib/worker";
import { getMyPayStubs } from "@/app/actions/worker-jobs";
import { PayStubCards } from "@/components/worker/pay-stub-card";

export default async function WorkerPayPage() {
  await requireWorker();
  const stubs = await getMyPayStubs();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Pay</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          What you&apos;ve earned, what&apos;s coming up, and what you&apos;re
          still owed — the same numbers the office sees.
        </p>
      </div>
      <PayStubCards stubs={stubs} />
    </div>
  );
}
