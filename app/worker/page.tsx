import { requireWorker } from "@/lib/worker";
import { listMyJobs, listMyAppointments } from "@/app/actions/worker-jobs";
import { WorkerJobsClient } from "@/components/worker/worker-jobs-client";

export default async function WorkerJobsPage() {
  await requireWorker();
  const [jobs, appointments] = await Promise.all([listMyJobs(), listMyAppointments()]);
  return <WorkerJobsClient initialJobs={jobs} appointments={appointments} />;
}
