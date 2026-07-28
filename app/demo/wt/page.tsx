import "@/components/landing2/landing.css";
import { DemoWalkthrough } from "@/components/landing2/demo-walkthrough";

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ act?: string }>;
}) {
  const { act } = await searchParams;
  return (
    <main className="bg-paper p-6">
      <div className="mx-auto max-w-[1200px]">
        <DemoWalkthrough initialAct={Number(act) || 0} />
      </div>
    </main>
  );
}
