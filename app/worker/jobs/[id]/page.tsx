import { notFound } from "next/navigation";
import { requireWorker } from "@/lib/worker";
import { getMyJob } from "@/app/actions/worker-jobs";
import { WorkerJobDetail } from "@/components/worker/worker-job-detail";

export default async function WorkerJobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorker();
  const { id } = await params;
  const job = await getMyJob(id);
  if (!job) notFound();
  return <WorkerJobDetail job={job} />;
}
