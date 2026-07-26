import { Logo } from "@/components/ui/logo";

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-ink">
      {/* Stripe accent band at the right edge */}
      <div
        aria-hidden
        className="hl-stripes absolute inset-y-0 right-0 hidden w-10 opacity-90 sm:block lg:w-14"
      />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-6 px-4 py-12 sm:flex-row sm:items-center sm:justify-between">
        <Logo className="text-white" />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <a
            className="font-label text-white/60 transition hover:text-white"
            href="#"
          >
            Privacy
          </a>
          <a
            className="font-label text-white/60 transition hover:text-white"
            href="#"
          >
            Terms
          </a>
          <a
            className="font-label text-white/60 transition hover:text-white"
            href="#"
          >
            Security
          </a>
          <a
            className="font-label text-white/60 transition hover:text-white"
            href="#"
          >
            Contact
          </a>
        </div>
        <div className="text-xs text-white/40 sm:pr-16">
          © {new Date().getFullYear()} FenceTrace Inc.
        </div>
      </div>
    </footer>
  );
}
