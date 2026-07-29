import { fenceType, type FenceTypeId } from "./fence/catalog";
import { packageTotal, type Proposal } from "./proposal-mock";

/**
 * Spoken summary of a proposal — the text behind the client portal's
 * "Listen to this quote" button. Deterministic template, NOT an LLM:
 * this is a money document, so the audio must read the exact same
 * numbers `packageTotal` puts on the page. Pure module (no server-only,
 * no DB) so it's unit-testable and hashable anywhere.
 *
 * WRITTEN FOR A WINDSHIELD, NOT A SCREEN. The listener is driving: they
 * get one pass, no scrollback, and roughly a minute of attention. So the
 * script is ordered by what a driver actually needs and everything else
 * is cut:
 *
 *   1. who it's from, and how long this will take
 *   2. WHAT they're getting — height, material, footage, gates. This is
 *      the spec that decides whether the price is even comparable to the
 *      other bids in their inbox, and it has to come before any number.
 *   3. the recommended package's price, alone, so one number lands
 *   4. the other two in a single compact sentence
 *   5. deposit + how long the price holds
 *   6. one action they can take at the wheel — call — and one for later
 *
 * Deliberately NOT spoken: the ZIP and state (they know their own
 * address), per-package marketing highlights (three paragraphs of
 * feature copy is unlistenable), warranty terms, line items. Those are
 * what the link is for.
 *
 * The hash of the script is the audio cache key: /api/p/[token]/audio
 * regenerates the MP3 only when the script text changes (price edit,
 * negotiated discount, package rename), otherwise serves the cached
 * blob. Keep the output stable — cosmetic rewording invalidates every
 * cached audio file at once.
 */

/** OpenAI TTS rejects inputs past 4096 chars; stay well under it. */
export const MAX_SCRIPT_CHARS = 4000;

/** Speaking rate we estimate the intro's "about N seconds" from. TTS
 *  voices at default speed land near this; it only has to be close
 *  enough that the promise isn't a lie. */
const WORDS_PER_SECOND = 2.6;

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Contractor copy is written for the eye ('6\' cedar privacy', '2"×4"
 * rails') — inch marks and × read as garbage in TTS. Rewrite the
 * measurement notation into speakable words.
 */
export function spokenText(s: string): string {
  return (
    s
      .replace(/(\d)\s*["″]?\s*[×x]\s*(\d+)\s*["″]/g, "$1 by $2 inch")
      .replace(/(\d)\s*["″]/g, "$1 inch")
      .replace(/×/g, " by ")
      // Package names carry typography meant for the eye — "Best — Cedar,
      // Stained & Sealed". An em dash makes some voices swallow the pause
      // and "&" can come out as "ampersand"; both become plain speech.
      .replace(/\s*[—–]\s*/g, ", ")
      .replace(/\s*&\s*/g, " and ")
      .replace(/\s+([,.])/g, "$1")
      .replace(/,\s*,/g, ",")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * A phone number a voice can actually dictate. "(512) 555-0184" makes
 * TTS read punctuation or run the digits together; grouped digits get
 * read at a pace someone can repeat back or dial at a light.
 */
export function spokenPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const local =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return raw.trim();
  const say = (s: string) => s.split("").join(" ");
  return `${say(local.slice(0, 3))}, ${say(local.slice(3, 6))}, ${say(local.slice(6))}`;
}

/**
 * Street line only. "1247 Maple Ridge Drive, Austin, TX 78704" spoken in
 * full wastes five seconds telling people where they live; the street is
 * enough to confirm which property this quote is for.
 */
export function spokenAddress(raw: string): string {
  return raw.split(",")[0]?.trim() ?? "";
}

/** "about 45 seconds" / "about a minute" / "about 2 minutes". */
function spokenDuration(wordCount: number): string {
  const secs = wordCount / WORDS_PER_SECOND;
  if (secs < 50)
    return `about ${Math.max(15, Math.round(secs / 15) * 15)} seconds`;
  if (secs < 80) return "about a minute";
  if (secs < 105) return "about a minute and a half";
  return `about ${Math.round(secs / 60)} minutes`;
}

/** Gate wording from the fence config — "a walk gate and a drive gate"
 *  beats "2 gates" when the difference is a thousand dollars. */
function gatePhrase(
  fence:
    | {
        gatesSingle?: number;
        gatesDouble?: number;
        gatesCustomWidthsFt?: number[];
      }
    | undefined,
  fallbackCount: number,
): string {
  const single = Math.max(0, Math.round(fence?.gatesSingle ?? 0));
  const dbl = Math.max(0, Math.round(fence?.gatesDouble ?? 0));
  const custom = (fence?.gatesCustomWidthsFt ?? []).length;
  const bits: string[] = [];
  if (single > 0)
    bits.push(single === 1 ? "a walk gate" : `${single} walk gates`);
  if (dbl > 0) bits.push(dbl === 1 ? "a drive gate" : `${dbl} drive gates`);
  if (custom > 0)
    bits.push(custom === 1 ? "a custom gate" : `${custom} custom gates`);
  if (bits.length === 0) {
    const n = Math.max(0, Math.round(fallbackCount));
    return n > 0 ? `${n} gate${n === 1 ? "" : "s"}` : "";
  }
  if (bits.length === 1) return bits[0];
  return `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}`;
}

export function buildProposalAudioScript(proposal: Proposal): string {
  const firstName = proposal.client.name.trim().split(/\s+/)[0] || "there";
  const company = proposal.contractor.company.trim() || "your contractor";
  const parts: string[] = [];

  /* ---- 2. the spec, before any price ---- */
  const discountPct = Math.max(0, Math.min(50, proposal.discountPct ?? 0));
  const priced = (proposal.packages ?? []).flatMap((p) => {
    try {
      const { total } = packageTotal(p, proposal.measurements, discountPct);
      return total > 0 ? [{ p, total }] : [];
    } catch {
      return []; // malformed measurements — skip the tier, keep the script
    }
  });
  const lead = priced.find(({ p }) => p.recommended) ?? priced[0] ?? null;
  const fence = lead?.p.config?.fence;

  const street = spokenAddress(proposal.address);
  const lf = Math.round(proposal.measurements?.eaveLF ?? 0);
  const gates = gatePhrase(fence, proposal.measurements?.downspoutCount ?? 0);

  if (lf > 0) {
    // "341 feet of 6 foot cedar privacy fence, with a walk gate and a
    // drive gate" — the sentence a homeowner repeats to their spouse.
    let spec = `${lf} feet of `;
    if (fence?.heightFt) spec += `${Math.round(fence.heightFt)} foot `;
    if (fence?.type) {
      try {
        spec += `${fenceType(fence.type as FenceTypeId).label.toLowerCase()} fence`;
      } catch {
        spec += "fence";
      }
    } else {
      spec += "fence";
    }
    if (gates) spec += `, with ${gates}`;
    parts.push(
      street
        ? `At ${street}, you're getting ${spec}.`
        : `You're getting ${spec}.`,
    );
    const removal = Math.round(fence?.removalLf ?? 0);
    parts.push(
      removal > 0
        ? `That includes taking the old fence out and hauling it away.`
        : `That includes the post holes, concrete, and cleanup.`,
    );
  } else if (street) {
    parts.push(`This is your fence quote for ${street}.`);
  }

  /* ---- 3. the number that matters, on its own ---- */
  if (lead) {
    const rec = lead.p.recommended
      ? `The option ${company} recommends is ${lead.p.name}, at ${money(lead.total)}.`
      : `The ${lead.p.name} package comes to ${money(lead.total)}.`;
    parts.push(rec);
  }

  /* ---- 4. the alternatives, compactly ---- */
  const others = priced.filter((x) => x !== lead);
  if (others.length === 1) {
    parts.push(
      `There's also ${others[0].p.name} at ${money(others[0].total)}.`,
    );
  } else if (others.length > 1) {
    const list = others
      .map((o) => `${o.p.name} at ${money(o.total)}`)
      .join(", and ");
    parts.push(`Your other options are ${list}.`);
  }

  if (discountPct > 0 && priced.length > 0) {
    const pct = Math.round(discountPct * 10) / 10;
    const label = proposal.discountLabel?.trim();
    parts.push(
      `A ${pct} percent discount${label ? ` for ${label}` : ""} is already in those prices.`,
    );
  }

  /* ---- 5. terms, one line ---- */
  const validDays = Math.round(proposal.validDays || 0);
  const depositPct = Math.round(proposal.depositPct || 0);
  if (depositPct > 0 && validDays > 0) {
    parts.push(
      `A ${depositPct} percent deposit books the job, and the price holds for ${validDays} days.`,
    );
  } else if (validDays > 0) {
    parts.push(`This price holds for ${validDays} days.`);
  } else if (depositPct > 0) {
    parts.push(`A ${depositPct} percent deposit books the job.`);
  }

  /* ---- 6. what to do, hands on the wheel ---- */
  const contractorName = proposal.contractor.name.trim();
  const phone = proposal.contractor.phone.trim();
  if (phone) {
    parts.push(
      `If you have questions, call ${contractorName || company} at ${spokenPhone(phone)}.`,
    );
  }
  parts.push(
    `When you're parked, open the link to see the drawing, the full materials list, and accept online.`,
  );

  /* ---- 1. the opener, written last so it can promise a length ---- */
  const body = parts.join(" ");
  const words = body.split(/\s+/).filter(Boolean).length;
  const opener =
    `Hi ${firstName}. Here's your fence quote from ${company} — ` +
    `${spokenDuration(words + 24)}, so you can keep driving.`;

  let script = `${opener} ${body}`;
  if (script.length > MAX_SCRIPT_CHARS) {
    const cut = script.lastIndexOf(". ", MAX_SCRIPT_CHARS);
    script =
      cut > 0 ? script.slice(0, cut + 1) : script.slice(0, MAX_SCRIPT_CHARS);
  }
  return spokenText(script);
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
