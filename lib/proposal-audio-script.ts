import { packageTotal, type Proposal } from "./proposal-mock";

/**
 * Spoken summary of a proposal — the text behind the client portal's
 * "Listen to this quote" button. Deterministic template, NOT an LLM:
 * this is a money document, so the audio must read the exact same
 * numbers `packageTotal` puts on the page. Pure module (no server-only,
 * no DB) so it's unit-testable and hashable anywhere.
 *
 * The hash of the script is the audio cache key: /api/p/[token]/audio
 * regenerates the MP3 only when the script text changes (price edit,
 * negotiated discount, package rename), otherwise serves the cached
 * blob. Keep the output stable — cosmetic rewording invalidates every
 * cached audio file at once.
 */

/** OpenAI TTS rejects inputs past 4096 chars; stay well under it. */
export const MAX_SCRIPT_CHARS = 4000;

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Contractor copy is written for the eye ('6\' cedar privacy', '2"×4"
 * rails') — inch marks and × read as garbage in TTS. Rewrite the
 * measurement notation into speakable words.
 */
export function spokenText(s: string): string {
  return s
    .replace(/(\d)\s*["″]?\s*[×x]\s*(\d+)\s*["″]/g, "$1 by $2 inch")
    .replace(/(\d)\s*["″]/g, "$1 inch")
    .replace(/×/g, " by ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildProposalAudioScript(proposal: Proposal): string {
  const firstName =
    proposal.client.name.trim().split(/\s+/)[0] || "there";
  const company = proposal.contractor.company.trim() || "your contractor";
  const parts: string[] = [];

  parts.push(
    `Hi ${firstName}. Here's a quick summary of your fence quote from ${company}, so you can listen on the go.`,
  );
  if (proposal.address.trim()) {
    parts.push(`This quote is for ${proposal.address.trim()}.`);
  }

  // Scope line from the measurements. jobType is an extra key on the
  // data blob (set by saveDraftFromEstimate), not part of the typed
  // Proposal shape — absent means we don't assume tear-off vs new build.
  const jobType = (proposal as Proposal & { jobType?: "new" | "replacement" })
    .jobType;
  const eave = Math.round(proposal.measurements?.eaveLF ?? 0);
  const spouts = Math.round(proposal.measurements?.downspoutCount ?? 0);
  if (eave > 0) {
    const spoutBit =
      spouts > 0 ? ` with ${spouts} gate${spouts === 1 ? "" : "s"}` : "";
    if (jobType === "replacement") {
      parts.push(
        `The job covers taking down your old fence and installing about ${eave} feet of new fence${spoutBit}, including full cleanup.`,
      );
    } else if (jobType === "new") {
      parts.push(
        `The job covers installing about ${eave} feet of new fence${spoutBit} on your property, including full cleanup.`,
      );
    } else {
      parts.push(
        `The job covers about ${eave} feet of fence${spoutBit}, installed and cleaned up.`,
      );
    }
  }

  // Package options — priced through the same packageTotal (markup →
  // discount → tax) the portal page uses, so the voice and the screen
  // can never disagree on a number.
  const discountPct = Math.max(0, Math.min(50, proposal.discountPct ?? 0));
  const priced = (proposal.packages ?? []).flatMap((p) => {
    try {
      const { total } = packageTotal(p, proposal.measurements, discountPct);
      return total > 0 ? [{ p, total }] : [];
    } catch {
      return []; // malformed measurements — skip the tier, keep the script
    }
  });

  if (priced.length === 1) {
    const { p, total } = priced[0];
    parts.push(`The ${p.name} package comes to ${money(total)}.`);
  } else if (priced.length > 1) {
    const countWord = COUNT_WORDS[priced.length] ?? String(priced.length);
    parts.push(`You have ${countWord} options.`);
    for (const { p, total } of priced) {
      const rec = p.recommended ? `, which ${company} recommends,` : "";
      const flavor = p.highlights?.[0]
        ? ` — that's ${spokenText(p.highlights[0])}`
        : "";
      parts.push(
        `The ${p.name} package${rec} comes to ${money(total)}${flavor}.`,
      );
    }
  }

  if (discountPct > 0 && priced.length > 0) {
    const pct = Math.round(discountPct * 10) / 10;
    const label = proposal.discountLabel?.trim();
    parts.push(
      `Good news — a ${pct} percent discount${label ? ` for ${label}` : ""} is already included in these prices.`,
    );
  }

  const validDays = Math.round(proposal.validDays || 0);
  const depositPct = Math.round(proposal.depositPct || 0);
  if (depositPct > 0 && validDays > 0) {
    parts.push(
      `A ${depositPct} percent deposit locks in your spot, and this pricing is valid for ${validDays} days.`,
    );
  } else if (validDays > 0) {
    parts.push(`This pricing is valid for ${validDays} days.`);
  }

  parts.push(
    `When you're parked, open the proposal link to see the full details, photos, and accept online.`,
  );
  const contractorName = proposal.contractor.name.trim();
  const phone = proposal.contractor.phone.trim();
  if (phone) {
    parts.push(
      `Questions? Call ${contractorName || company} at ${phone}. Thanks!`,
    );
  } else {
    parts.push(`Thanks!`);
  }

  let script = parts.join(" ");
  if (script.length > MAX_SCRIPT_CHARS) {
    const cut = script.lastIndexOf(". ", MAX_SCRIPT_CHARS);
    script =
      cut > 0 ? script.slice(0, cut + 1) : script.slice(0, MAX_SCRIPT_CHARS);
  }
  return script;
}

/**
 * FNV-1a 64-bit hash of the script text — the audio cache key stored on
 * the proposal row. Pure JS (no node:crypto) so this module stays
 * importable from tests and client code alike. A collision would only
 * mean serving one stale audio file, and across the handful of versions
 * a single proposal ever has, 64 bits is far beyond overkill.
 */
export function audioScriptHash(script: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < script.length; i++) {
    h ^= BigInt(script.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}
