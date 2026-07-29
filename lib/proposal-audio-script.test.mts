/**
 * Pure node tests for the proposal audio-summary script builder. The
 * script feeds TTS on the client portal, so the invariants that matter:
 * every number spoken must equal what packageTotal renders on screen,
 * measurement notation must be speakable, the driver hears the spec
 * before any price, and the hash must be a stable cache key. Run with:
 *   npx tsx --test lib/proposal-audio-script.test.mts
 * No DB, no AI, no network — deterministic functions only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProposalAudioScript,
  audioScriptHash,
  spokenAddress,
  spokenPhone,
  spokenText,
  MAX_SCRIPT_CHARS,
} from "./proposal-audio-script.ts";
import {
  sampleProposal,
  packageTotal,
  type Proposal,
} from "./proposal-mock.ts";

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const totalFor = (p: Proposal["packages"][number], prop: Proposal) =>
  packageTotal(p, prop.measurements, prop.discountPct ?? 0).total;

test("opens with the client's first name, the company, and a length promise", () => {
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(s.startsWith("Hi Sarah."), s.slice(0, 80));
  assert.ok(s.includes("Rivera Fenceworks"));
  assert.match(s, /about (a minute|a minute and a half|\d+ (seconds|minutes))/);
});

test("every package total spoken matches packageTotal exactly", () => {
  const s = buildProposalAudioScript(sampleProposal);
  for (const p of sampleProposal.packages) {
    const total = totalFor(p, sampleProposal);
    assert.ok(
      s.includes(money(total)),
      `missing total ${money(total)} for ${p.name}`,
    );
    // Package names carry display typography ("Best — Cedar, Stained &
    // Sealed"); the script speaks the normalised form.
    assert.ok(s.includes(spokenText(p.name)), `missing package name ${p.name}`);
  }
});

test("the recommended tier is spoken first and alone, before the others", () => {
  const s = buildProposalAudioScript(sampleProposal);
  const rec = sampleProposal.packages.find((p) => p.recommended)!;
  assert.ok(s.includes(`recommends is ${spokenText(rec.name)}`), s);
  // A driver gets one number to hold: the recommended price must land
  // before the sentence listing the alternatives.
  const recAt = s.indexOf(money(totalFor(rec, sampleProposal)));
  const othersAt = s.indexOf("Your other options are");
  assert.ok(
    recAt > -1 && othersAt > recAt,
    "recommended price must come first",
  );
});

test("the spec — footage, height, material, gates — is spoken before any price", () => {
  const s = buildProposalAudioScript(sampleProposal);
  const rec = sampleProposal.packages.find((p) => p.recommended)!;
  const fence = rec.config.fence!;
  const lf = Math.round(sampleProposal.measurements.eaveLF);
  assert.ok(s.includes(`${lf} feet of`), `missing footage: ${s}`);
  assert.ok(
    s.includes(`${Math.round(fence.heightFt)} foot`),
    `missing height: ${s}`,
  );
  const specAt = s.indexOf(`${lf} feet of`);
  const priceAt = s.indexOf(money(totalFor(rec, sampleProposal)));
  assert.ok(specAt > -1 && priceAt > specAt, "spec must precede the price");
});

test("gates are described by kind, not just counted", () => {
  const rec = sampleProposal.packages.find((p) => p.recommended)!;
  const withGates: Proposal = {
    ...sampleProposal,
    packages: sampleProposal.packages.map((p) =>
      p.id === rec.id
        ? {
            ...p,
            config: {
              ...p.config,
              fence: { ...p.config.fence!, gatesSingle: 1, gatesDouble: 1 },
            },
          }
        : p,
    ),
  };
  const s = buildProposalAudioScript(withGates);
  assert.ok(s.includes("a walk gate and a drive gate"), s);
});

test("tear-out is only promised when the job actually removes a fence", () => {
  const rec = sampleProposal.packages.find((p) => p.recommended)!;
  const patch = (removalLf: number): Proposal => ({
    ...sampleProposal,
    packages: sampleProposal.packages.map((p) =>
      p.id === rec.id
        ? {
            ...p,
            config: { ...p.config, fence: { ...p.config.fence!, removalLf } },
          }
        : p,
    ),
  });
  assert.ok(
    buildProposalAudioScript(patch(120)).includes("taking the old fence out"),
  );
  assert.ok(
    !buildProposalAudioScript(patch(0)).includes("taking the old fence out"),
  );
});

test("a discount changes the spoken prices and is announced", () => {
  const discounted: Proposal = {
    ...sampleProposal,
    discountPct: 10,
    discountLabel: "Spring promo",
  };
  const s = buildProposalAudioScript(discounted);
  assert.ok(s.includes("10 percent discount"));
  assert.ok(s.includes("Spring promo"));
  const rec = discounted.packages.find((p) => p.recommended)!;
  assert.ok(s.includes(money(totalFor(rec, discounted))));
  const listTotal = packageTotal(rec, discounted.measurements, 0).total;
  assert.ok(
    !s.includes(money(listTotal)),
    "must not speak the undiscounted price",
  );
});

test("deposit and validity are spoken as one line", () => {
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(s.includes("A 30 percent deposit books the job"));
  assert.ok(s.includes("price holds for 30 days"));
});

test("the ZIP and state are not read out — street only", () => {
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(s.includes("1247 Maple Ridge Drive"));
  assert.ok(!s.includes("78704"), "ZIP must not be spoken");
  assert.ok(!s.includes(", Austin, TX"), "city/state must not be spoken");
  assert.equal(spokenAddress("12 Oak St, Austin, TX 78704"), "12 Oak St");
  assert.equal(spokenAddress(""), "");
});

test("phone numbers are dictated as grouped digits", () => {
  assert.equal(spokenPhone("(512) 555-0184"), "5 1 2, 5 5 5, 0 1 8 4");
  assert.equal(spokenPhone("+1 512 555 0184"), "5 1 2, 5 5 5, 0 1 8 4");
  // Unparseable numbers pass through rather than being mangled.
  assert.equal(spokenPhone("ext 401"), "ext 401");
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(s.includes("5 1 2, 5 5 5, 0 1 8 4"), s);
});

test("per-package marketing highlights are NOT read out", () => {
  const s = buildProposalAudioScript(sampleProposal);
  for (const p of sampleProposal.packages) {
    const h = p.highlights?.[0];
    if (h) assert.ok(!s.includes(spokenText(h)), `highlight leaked: ${h}`);
  }
});

test('measurement notation is speakable: 5" → 5 inch, 2"×3" → 2 by 3 inch', () => {
  assert.equal(
    spokenText('5" K-style aluminum gutters'),
    "5 inch K-style aluminum gutters",
  );
  assert.equal(spokenText('2"×3" downspouts'), "2 by 3 inch downspouts");
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(!/\d"/.test(s), `raw inch mark leaked into script: ${s}`);
  assert.ok(!s.includes("×"), "raw × leaked into script");
});

test("empty packages / blank fields degrade gracefully, never throw", () => {
  const bare: Proposal = {
    ...sampleProposal,
    client: { name: "", email: "" },
    contractor: {
      ...sampleProposal.contractor,
      company: "",
      name: "",
      phone: "",
    },
    address: "",
    packages: [],
    measurements: {
      ...sampleProposal.measurements,
      eaveLF: 0,
      downspoutCount: 0,
    },
  };
  const s = buildProposalAudioScript(bare);
  assert.ok(s.includes("Hi there."));
  assert.ok(s.includes("your contractor"));
  assert.ok(s.length > 0);
});

test("stays under the TTS ceiling, and short enough to listen to", () => {
  const s = buildProposalAudioScript(sampleProposal);
  assert.ok(s.length <= MAX_SCRIPT_CHARS);
  // ~2.6 words/sec: the whole point is that this is a drive-time
  // summary, so guard the upper bound at roughly 75 seconds.
  const words = s.split(/\s+/).filter(Boolean).length;
  assert.ok(words < 200, `script is ${words} words — too long to listen to`);

  const bloated: Proposal = {
    ...sampleProposal,
    packages: sampleProposal.packages.map((p) => ({
      ...p,
      highlights: ["premium seamless gutter system ".repeat(80)],
    })),
  };
  assert.ok(buildProposalAudioScript(bloated).length <= MAX_SCRIPT_CHARS);
});

test("hash is stable for identical input and moves when the price moves", () => {
  const a = buildProposalAudioScript(sampleProposal);
  const b = buildProposalAudioScript({ ...sampleProposal });
  assert.equal(audioScriptHash(a), audioScriptHash(b));
  const repriced = buildProposalAudioScript({
    ...sampleProposal,
    discountPct: 5,
  });
  assert.notEqual(audioScriptHash(a), audioScriptHash(repriced));
  assert.match(audioScriptHash(a), /^[0-9a-f]{16}$/);
});
