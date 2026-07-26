import { listMaterialDefaults } from "@/app/actions/material-defaults";
import { MaterialDefaultsEditor } from "@/components/admin/material-defaults-editor";

export default async function AdminMaterialDefaultsPage() {
  const rows = await listMaterialDefaults();

  return (
    <div className="mx-auto max-w-[1400px]">
      <header className="mb-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
          Material defaults
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Baseline national-average prices that pre-populate every new
          contractor's account. Existing contractors keep their own overrides.
        </p>
      </header>

      <MaterialDefaultsEditor rows={rows} />
    </div>
  );
}
