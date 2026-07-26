// Server-component layout for /estimate. Only purpose: host the
// `maxDuration` export. The address pipeline (geocode → Solar API →
// satellite → SAM-2 → vision edge classifier → ridge merge) typically
// takes 25-50s end-to-end. Vercel's default function timeout is ~10s,
// which was killing the server action mid-call and leaving the UI
// stuck on "Building takeoff…" forever. 90s is the Vercel Pro ceiling
// without bumping plans.
//
// This lives on a layout rather than the page because the page is a
// Client Component ("use client") and route segment config exports
// (maxDuration, runtime, etc.) are only valid from Server Components.
export const maxDuration = 90;

export default function EstimateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
