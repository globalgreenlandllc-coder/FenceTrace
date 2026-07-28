import { Container, Eyebrow, PillLink } from "./ui";
import { Reveal } from "./reveal";
import { DemoWalkthrough } from "./demo-walkthrough";
import { DEMO_ADDRESS, TOTAL_LF } from "./demo-property";

/**
 * The Smart Takeoffs section — and the page's main proof. It leads with
 * the demo property: a prebuilt address that scans itself, draws its own
 * backyard fence, builds in 3D, prices into a proposal and gets signed,
 * all in about forty seconds and all off the real engine.
 */
export function Engine() {
  return (
    <section id="takeoffs" className="bg-paper py-24 md:py-32">
      <Container>
        <Reveal>
          <div className="grid gap-8 md:grid-cols-[1.05fr_0.95fr] md:items-end md:gap-16">
            <div>
              <Eyebrow>Smart Takeoffs</Eyebrow>
              <h2 className="mt-6 text-[30px] font-semibold leading-[1.05] tracking-tight text-zinc-900 md:text-[40px]">
                Watch a whole job happen{" "}
                <span className="text-zinc-400">
                  between two sips of coffee
                </span>
              </h2>
            </div>
            <div className="max-w-md md:justify-self-end">
              <p className="text-[15px] leading-relaxed text-zinc-600">
                This is {DEMO_ADDRESS} — a demo property wired to the live
                engine. The boundary, the {TOTAL_LF} feet of fence, the post
                count, the packages: every number below is computed, not typed
                in. Nothing here is a mockup.
              </p>
              <div className="mt-6">
                <PillLink href="/sign-in">Run it on a real address</PillLink>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <DemoWalkthrough />
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 sm:grid-cols-3">
            {[
              {
                t: "Fence lines traced from the sky",
                b: "An afternoon with a wheel and a tape. Instant here.",
              },
              {
                t: "Property lines pulled automatically",
                b: "County parcel records, not a guess off a satellite photo.",
              },
              {
                t: "Proposals sent the same hour",
                b: "3D model, e-signature and deposit in the same link.",
              },
            ].map((r) => (
              <div key={r.t} className="bg-white p-6">
                <p className="text-[14.5px] font-semibold tracking-tight text-zinc-900">
                  {r.t}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">
                  {r.b}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
