import { requireWorker } from "@/lib/worker";
import { listMyJobs, listMyAppointments } from "@/app/actions/worker-jobs";
import { WorkerSchedule } from "@/components/worker/worker-schedule";

export default async function WorkerSchedulePage() {
  await requireWorker();
  const [jobs, appointments] = await Promise.all([listMyJobs(), listMyAppointments()]);
  return <WorkerSchedule jobs={jobs} appointments={appointments} />;
}
