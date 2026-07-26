import {
  CalendarDays,
  FileSignature,
  Layers,
  Map,
  Receipt,
  Satellite,
} from "lucide-react";
import { Container, SectionHeader } from "./ui";
import { Reveal } from "./reveal";

// "One takeoff. The whole job." — the platform-breadth section. Every
// card here maps to a real, shipped feature (calendar, crew portal,
// payment tracking, permit leads); the client CRM is deliberately
// absent because /dashboard/clients is still a stub.

const FEATURES = [
  {
    icon: Satellite,
    title: "Smart takeoffs",
    body: "Satellite measurements in minutes — fence runs, corners, and gates, priced from your own rate card.",
  },
  {
    icon: Layers,
    title: "Three-tier proposals",
    body: "Good · Better · Best packages sized to the property, branded to your company, and sent the same hour you get the address.",
  },
  {
    icon: FileSignature,
    title: "E-sign client portal",
    body: "Homeowners review the bid, pick a package, and sign from their phone — no login, no PDFs, no printer.",
  },
  {
    icon: Receipt,
    title: "Payments, tracked",
    body: "Deposits, installment schedules, receipts, change orders, and automatic overdue reminders — every dollar visible.",
  },
  {
    icon: CalendarDays,
    title: "Calendar & crew",
    body: "Drag-and-drop scheduling for site visits and installs, plus a worker portal that keeps your pricing private.",
  },
  {
    icon: Map,
    title: "Permit leads map",
    body: "New construction and remodel permits near you, scored for fence intent — pick a pin and scan it before the drive.",
  },
];

export function Platform() {
  return (
    <section id="platform" className="bg-paper py-24 md:py-32">
      <Container>
        <Reveal>
          <SectionHeader
            eyebrow="The Platform"
            title={
              <>
                One takeoff.
                <br />
                The whole job.
              </>
            }
            copy="FenceTrace doesn't stop at the measurement. Every takeoff flows into a tiered proposal, an e-signature, a schedule, and a paid, receipted job — in one place."
          />
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={0.05 + i * 0.05}>
              <div className="group h-full rounded-2xl border border-zinc-200/70 bg-white p-6 shadow-card transition duration-300 will-change-transform hover:-translate-y-1 hover:shadow-elevated motion-reduce:transform-none">
                <div className="transition-smooth flex h-10 w-10 items-center justify-center rounded-xl bg-accent-50 group-hover:bg-accent-100">
                  <f.icon className="h-5 w-5 text-accent-600" />
                </div>
                <h3 className="mt-4 text-[16px] font-semibold tracking-tight text-zinc-900">
                  {f.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-500">
                  {f.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
