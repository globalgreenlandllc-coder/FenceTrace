import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getActiveApiKey } from "@/lib/api-keys";
import { simplify } from "./geometry";

/**
 * building-footprint.ts — traces the MAIN house off the scan's own
 * satellite image when OpenStreetMap has nothing on the parcel.
 *
 * OSM's footprint coverage (largely the Microsoft import) is spotty on
 * exactly the lots FenceScan cares about — rural parcels, new builds —
 * and it regularly knows the neighbor's house but not the subject's.
 * The aerial is already in hand, so the fallback is to read the house
 * straight off it. The result seeds the canvas House layer; the
 * contractor can always re-trace by hand.
 */

const MODEL = "claude-sonnet-5";

export type FootprintResult = {
  /** Outline in image pixel coords (the 900×580 scan canvas), or null. */
  ring: { x: number; y: number }[] | null;
};

export async function extractBuildingFootprint(source: {
  /** PNG/JPEG base64 (no data: prefix) of the scan aerial. */
  base64: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}): Promise<FootprintResult> {
  const apiKey =
    (await getActiveApiKey("ANTHROPIC")) ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey) return { ring: null };

  const client = new Anthropic({ apiKey });
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      tools: [
        {
          name: "report_footprint",
          description:
            "Report the roof outline of the main residential building.",
          input_schema: {
            type: "object" as const,
            properties: {
              found: { type: "boolean" },
              points: {
                type: "array",
                description:
                  "Roof outline vertices in image pixels, in drawing order.",
                items: {
                  type: "object",
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                  },
                  required: ["x", "y"],
                },
              },
            },
            required: ["found"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "report_footprint" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: source.mimeType,
                data: source.base64,
              },
            },
            {
              type: "text",
              text:
                `This is a ${source.width}×${source.height} pixel satellite image of a residential property, ` +
                `roughly centered on the subject parcel. Trace the roof outline of the MAIN house nearest ` +
                `the image center — not sheds, not vehicles, not driveways, not tree canopy, and not ` +
                `buildings on neighboring lots near the edges. Give 4–14 vertices in image pixel ` +
                `coordinates following the actual roof edges (L-shapes and wings matter). ` +
                `If no building is clearly visible, report found=false.`,
            },
          ],
        },
      ],
    });
    const tool = res.content.find((b) => b.type === "tool_use");
    if (!tool || tool.type !== "tool_use") return { ring: null };
    const input = tool.input as {
      found?: boolean;
      points?: { x?: number; y?: number }[];
    };
    if (!input.found || !Array.isArray(input.points)) return { ring: null };
    const ring = input.points
      .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter(
        (p) =>
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          p.x >= -20 &&
          p.x <= source.width + 20 &&
          p.y >= -20 &&
          p.y <= source.height + 20,
      );
    if (ring.length < 3) return { ring: null };
    // A vision trace wobbles a little — snap near-colinear vertices away
    // so the house reads as architecture, not a freehand blob.
    const clean = simplify(ring, 3);
    if (clean.length < 3) return { ring: null };
    // Reject degenerate slivers (shadow lines, fence runs read as roofs).
    let area2 = 0;
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i];
      const b = clean[(i + 1) % clean.length];
      area2 += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(area2 / 2) < 400) return { ring: null };
    return { ring: clean };
  } catch (e) {
    console.warn(
      "[building-footprint] vision extraction failed",
      e instanceof Error ? e.message : e,
    );
    return { ring: null };
  }
}
