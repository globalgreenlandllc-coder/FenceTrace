import { listPromptTemplates } from "@/app/actions/prompts";
import { PromptsEditor } from "@/components/admin/prompts-editor";

export default async function AdminPromptsPage() {
  const rows = await listPromptTemplates();

  return (
    <div className="mx-auto max-w-[1100px]">
      <header className="mb-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
          AI prompts
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Edit the instructions that drive the address scan and the blueprint
          scan. Changes take effect on the next estimate — no redeploy. Each
          prompt can be reverted to the version that ships with the app.
        </p>
      </header>

      <PromptsEditor rows={rows} />
    </div>
  );
}
