import OpenAI from "openai";

import { getActiveApiKey } from "@/lib/api-keys";

export type CategorizedTrade =
  | "Roofing"
  | "Gutters"
  | "Framing"
  | "Siding"
  | "Windows"
  | "General"
  | "Other";

export type AiRelevance = "high" | "medium" | "low";

export interface PermitInsight {
  trade: CategorizedTrade;
  summary: string;
  relevance: AiRelevance;
}

const VALID_TRADES: CategorizedTrade[] = [
  "Roofing",
  "Gutters",
  "Framing",
  "Siding",
  "Windows",
  "General",
  "Other",
];

function fallbackInsight(description: string): PermitInsight {
  const lower = description.toLowerCase();
  let trade: CategorizedTrade = "Other";
  if (lower.includes("roof") || (lower.includes("r&r") && lower.includes("shingle"))) trade = "Roofing";
  else if (lower.includes("gutter") || lower.includes("downspout")) trade = "Gutters";
  else if (lower.includes("framing") || lower.includes("addition") || lower.includes("new sfr")) trade = "Framing";
  else if (lower.includes("siding")) trade = "Siding";
  else if (lower.includes("window")) trade = "Windows";

  // Naive relevance: new-construction & re-roofs are highest value for gutters.
  let relevance: AiRelevance = "low";
  if (trade === "Roofing" || trade === "Framing" || trade === "Siding") relevance = "high";
  else if (trade === "Windows" || trade === "Gutters") relevance = "medium";

  // First sentence-ish summary.
  const summary = description.split(/[.\n]/)[0].slice(0, 140);

  return { trade, summary, relevance };
}

export async function analyzePermit(
  description: string,
  buildingType?: string,
): Promise<PermitInsight> {
  // Prefer the admin-console key (so it can be rotated without redeploying),
  // but fall back to a standard OPENAI_API_KEY env var so the same code path
  // works in environments that haven't been onboarded to the admin console
  // yet (e.g. early Vercel previews, CI, or scripted backfills).
  const apiKey = (await getActiveApiKey("OPENAI")) ?? process.env.OPENAI_API_KEY ?? null;

  if (!apiKey) return fallbackInsight(description);

  try {
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You analyze municipal building permits for a gutter contractor who also tracks roofing/framing/siding/windows leads.

Output JSON: {"trade": ..., "summary": ..., "relevance": ...}

CRITICAL RULE: NEVER copy or echo the input description into "summary". The input is verbose government boilerplate. Your "summary" must be a SHORT (max 12 words) natural-English rewrite that a salesperson can scan. If you cannot compress, output "Permit work" — never repeat the input.

Keys:
- "trade": one of "Roofing" | "Gutters" | "Framing" | "Siding" | "Windows" | "General" | "Other".
- "summary": ≤12 words, plain English. NO capitalized boilerplate. NO "A Single Family Residential ...". Decode the fixture list into normal language.
- "relevance": "high" | "medium" | "low".
  - HIGH = ground-up new build, full reroof, full re-side, large addition with new exterior surfaces
  - MEDIUM = significant remodel, partial reroof, window swap, ADU/garage build, gas piping addition
  - LOW = water heater swap, electrical-only, branch circuits, panel swap, plumbing-only, HVAC swap, fireplace insert, interior-only alteration, sign, generator load test`,
        },
        // Few-shot examples — the AI follows demonstrated patterns far better
        // than prose instructions.
        {
          role: "user",
          content: `Permit description:
A Single Family Residential Repair or Replacement None Project Involving (1 Water Heater Electric < 60 gallons, 1 Water Service - 1")`,
        },
        {
          role: "assistant",
          content: `{"trade":"Other","summary":"Water heater swap with new water service","relevance":"low"}`,
        },
        {
          role: "user",
          content: `Permit description:
A Single Family Residential New Structure None Project Involving (1 Dwelling Unit, 1 Furnace, 1 Water Heater, 1 Building)`,
        },
        {
          role: "assistant",
          content: `{"trade":"Framing","summary":"New single-family home with furnace and water heater","relevance":"high"}`,
        },
        {
          role: "user",
          content: `Permit description:
A Nonresidential Alteration to Existing Structure Electrical Project Involving (3 Added or Altered Branch Circuits)`,
        },
        {
          role: "assistant",
          content: `{"trade":"Other","summary":"Three branch-circuit additions in commercial building","relevance":"low"}`,
        },
        {
          role: "user",
          content: `Permit description:
TEAR OFF COMP SHINGLES, INSTALL ICE SHIELD & R&R FLASHING ON SFR`,
        },
        {
          role: "assistant",
          content: `{"trade":"Roofing","summary":"Full re-roof with ice shield and new flashing","relevance":"high"}`,
        },
        {
          role: "user",
          content: buildingType
            ? `Building type: ${buildingType}\n\nPermit description:\n${description}`
            : `Permit description:\n${description}`,
        },
      ],
    });

    const raw = response.choices[0].message.content?.trim() ?? "{}";
    const parsed = JSON.parse(raw) as Partial<PermitInsight>;

    const trade: CategorizedTrade = VALID_TRADES.includes(parsed.trade as CategorizedTrade)
      ? (parsed.trade as CategorizedTrade)
      : "Other";

    const relevance: AiRelevance =
      parsed.relevance === "high" || parsed.relevance === "medium" || parsed.relevance === "low"
        ? parsed.relevance
        : "low";

    const summary =
      typeof parsed.summary === "string" && parsed.summary.length > 0
        ? parsed.summary.slice(0, 200)
        : description.slice(0, 140);

    return { trade, summary, relevance };
  } catch (error) {
    console.error("AI analyzePermit error:", error);
    return fallbackInsight(description);
  }
}

// Back-compat: older callers may still expect a single trade word.
export async function normalizePermitDescription(description: string): Promise<CategorizedTrade> {
  return (await analyzePermit(description)).trade;
}
