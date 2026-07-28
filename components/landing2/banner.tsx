import Link from "next/link";

export function Banner() {
  return (
    <div className="flex h-9 items-center bg-accent-950 px-4 text-[12px] text-white/60 md:px-8">
      <span className="hidden h-[7px] w-[7px] rounded-[2px] bg-accent-400 md:inline-block" />
      <p className="mx-auto min-w-0 truncate font-mono text-[10.5px] font-bold uppercase tracking-wide">
        FenceScan now measures properties in all 50 states &middot; Proposals,
        payments &amp; scheduling are live
      </p>
      <Link
        href="/sign-in"
        className="ring-focus-dark group hidden shrink-0 rounded-sm font-mono text-[10.5px] font-bold uppercase tracking-wide text-accent-300 transition hover:text-accent-200 md:inline"
      >
        Read the announcement{" "}
        <span className="inline-block transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none">
          &rarr;
        </span>
      </Link>
    </div>
  );
}
