import { listSupportTickets } from "@/app/actions/support";
import { SupportInbox } from "@/components/admin/support-inbox";

export const dynamic = "force-dynamic";

export default async function AdminSupportPage() {
  const tickets = await listSupportTickets();
  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
          Support
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Tickets from your users. Reply here — they get emailed. AI can draft
          a reply and triage the topic.
        </p>
      </header>
      <SupportInbox initial={tickets} />
    </div>
  );
}
