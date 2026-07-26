import { listAnnouncements } from "@/app/actions/announcements";
import { AnnouncementsManager } from "@/components/admin/announcements-manager";

export const dynamic = "force-dynamic";

export default async function AdminAnnouncementsPage() {
  const res = await listAnnouncements();
  const initial = res.ok ? res.announcements : [];

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
          Announcements
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Broadcast to every account — shown as an in-app banner, and
          optionally emailed. Draft with AI, pick the audience, publish.
        </p>
      </header>
      <AnnouncementsManager initial={initial} />
    </div>
  );
}
