import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { getActiveApiKey } from "@/lib/api-keys";
import { simplify } from "./geometry";

/**
 * building-footprint.ts — traces the MAIN house off the scan's own
 * satellite image when OpenStreetMap has nothing on the parcel.
 *
 * A vision model asked for raw pixel vertices on a wide 900×580 frame
 * answers with a plausible house SHAPE in the wrong PLACE — offsets of
 * 10%+ of the frame are routine, and on busy blocks it locks onto the
 * neighbor. So this runs as a pipeline instead of a one-shot ask:
 *
 *  1. MASK — everything outside the parcel ring is dimmed to near-black
 *     (sharp composite, even-odd hole). The neighbor's roof is no
 *     longer a candidate because the model can barely see it.
 *  2. LOCATE — one cheap call: a rough bounding box of the main
 *     building in the masked frame. Boxes are far more reliable than
 *     vertices.
 *  3. ZOOM + TRACE — crop that box (with margin) from the ORIGINAL
 *     image, upscale 2×, and ask for the roof outline inside the crop.
 *     The house now fills the frame, so the same coordinate error
 *     lands 4× tighter. Vertices map back through the crop transform.
 *  4. VALIDATE — centroid must sit inside the parcel, slivers are
 *     rejected, and the ring is simplified so it reads as architecture.
 *
 * Every failure returns null: the caller loses nothing but the house,
 * and the canvas House tool remains the manual override.
 */

const MODEL = "claude-sonnet-5";

type Pt = { x: number; y: number };

export type FootprintResult = {
  /** Outline in image pixel coords (the 900×580 scan canvas), or null. */
  ring: Pt[] | null;
};

function inRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function ringArea(ring: Pt[]): number {
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2 / 2);
}

/** Dim everything outside the parcel so neighbors stop being candidates.
 *  Drawn at the PNG's REAL dimensions — scan aerials are usually retina
 *  (2×) copies of the 900×580 canvas, and an overlay at canvas size
 *  would get centered by sharp instead of covering the frame. */
async function maskOutsideParcel(
  png: Buffer,
  imgW: number,
  imgH: number,
  parcelImgSpace: Pt[],
): Promise<Buffer> {
  const pts = parcelImgSpace.map((p) => `${p.x},${p.y}`).join(" ");
  const overlay = Buffer.from(
    `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">
       <path d="M0 0H${imgW}V${imgH}H0Z M${pts.replaceAll(" ", " L")} Z"
             fill="black" fill-opacity="0.72" fill-rule="evenodd"/>
       <polygon points="${pts}" fill="none" stroke="#00E5FF" stroke-width="${Math.max(3, imgW / 300)}"/>
     </svg>`,
  );
  return sharp(png).composite([{ input: overlay }]).png().toBuffer();
}

export async function extractBuildingFootprint(source: {
  /** PNG/JPEG base64 (no data: prefix) of the scan aerial. */
  base64: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  /** Parcel ring in the same pixel space — enables the neighbor mask
   *  and the final on-parcel check. */
  parcelRing?: Pt[];
}): Promise<FootprintResult> {
  const apiKey =
    (await getActiveApiKey("ANTHROPIC")) ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey) return { ring: null };
  const client = new Anthropic({ apiKey });
  const { width, height } = source;
  const parcel =
    source.parcelRing && source.parcelRing.length >= 3 ? source.parcelRing : null;

  try {
    const original = Buffer.from(source.base64, "base64");
    // The aerial's REAL pixel size — retina scans are 2× the canvas.
    // All model I/O runs in image space; only the final ring converts
    // back to canvas coordinates.
    const meta = await sharp(original).metadata();
    const imgW = meta.width ?? width;
    const imgH = meta.height ?? height;
    const sx = imgW / width;
    const sy = imgH / height;
    const parcelImg = parcel
      ? parcel.map((p) => ({ x: p.x * sx, y: p.y * sy }))
      : null;
    const located = parcelImg
      ? await maskOutsideParcel(original, imgW, imgH, parcelImg)
      : original;

    // ---- Stage 1: rough bounding box on the (masked) full frame ----
    const bboxRes = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      tools: [
        {
          name: "report_bbox",
          description: "Report the bounding box of the main residential building.",
          input_schema: {
            type: "object" as const,
            properties: {
              found: { type: "boolean" },
              x0: { type: "number" },
              y0: { type: "number" },
              x1: { type: "number" },
              y1: { type: "number" },
            },
            required: ["found"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "report_bbox" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: located.toString("base64") },
            },
            {
              type: "text",
              text:
                `A ${imgW}×${imgH} px satellite image.` +
                (parcel
                  ? " The bright region inside the cyan outline is the subject parcel; everything else is dimmed."
                  : "") +
                ` Report the pixel bounding box (x0,y0 top-left → x1,y1 bottom-right) of the MAIN residential ` +
                `building${parcel ? " inside the bright parcel" : " nearest the image center"}. A building is a ` +
                `roof — not tree canopy, not driveway, not shadows. found=false if none is visible.`,
            },
          ],
        },
      ],
    });
    const bboxTool = bboxRes.content.find((b) => b.type === "tool_use");
    if (!bboxTool || bboxTool.type !== "tool_use") return { ring: null };
    const bb = bboxTool.input as {
      found?: boolean; x0?: number; y0?: number; x1?: number; y1?: number;
    };
    if (!bb.found) return { ring: null };
    let x0 = Math.min(Number(bb.x0), Number(bb.x1));
    let x1 = Math.max(Number(bb.x0), Number(bb.x1));
    let y0 = Math.min(Number(bb.y0), Number(bb.y1));
    let y1 = Math.max(Number(bb.y0), Number(bb.y1));
    if (![x0, x1, y0, y1].every(Number.isFinite)) return { ring: null };
    // Margin so a sloppy box still contains the eaves, then clamp.
    const mx = (x1 - x0) * 0.25 + 12;
    const my = (y1 - y0) * 0.25 + 12;
    x0 = Math.max(0, Math.floor(x0 - mx));
    y0 = Math.max(0, Math.floor(y0 - my));
    x1 = Math.min(imgW, Math.ceil(x1 + mx));
    y1 = Math.min(imgH, Math.ceil(y1 + my));
    const cw = x1 - x0;
    const ch = y1 - y0;
    if (cw < 24 || ch < 24) return { ring: null };

    // ---- Stage 2: crop from the ORIGINAL, zoom, trace ----
    // Upscale for precision but cap the long edge so token cost stays
    // sane on retina crops that are already big.
    const SCALE = Math.max(1, Math.min(2, 1400 / Math.max(cw, ch)));
    const outW = Math.round(cw * SCALE);
    const outH = Math.round(ch * SCALE);
    const crop = await sharp(original)
      .extract({ left: x0, top: y0, width: cw, height: ch })
      .resize(outW, outH, { kernel: "lanczos3" })
      .png()
      .toBuffer();
    const traceRes = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      tools: [
        {
          name: "report_footprint",
          description: "Report the roof outline of the building.",
          input_schema: {
            type: "object" as const,
            properties: {
              found: { type: "boolean" },
              points: {
                type: "array",
                items: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
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
              source: { type: "base64", media_type: "image/png", data: crop.toString("base64") },
            },
            {
              type: "text",
              text:
                `A ${outW}×${outH} px close-up of one building's roof. Trace the roof outline: ` +
                `4–14 vertices in THIS image's pixel coordinates, in drawing order, following the actual ` +
                `eave lines — wings and L-shapes matter. Exclude decks, driveways and overhanging trees. ` +
                `found=false only if there is no roof here.`,
            },
          ],
        },
      ],
    });
    const traceTool = traceRes.content.find((b) => b.type === "tool_use");
    if (!traceTool || traceTool.type !== "tool_use") return { ring: null };
    const tr = traceTool.input as { found?: boolean; points?: { x?: number; y?: number }[] };
    if (!tr.found || !Array.isArray(tr.points)) return { ring: null };

    // Map back: crop px → image px → CANVAS px (what the app stores).
    const ring = tr.points
      .map((p) => ({
        x: (x0 + Number(p?.x) / SCALE) / sx,
        y: (y0 + Number(p?.y) / SCALE) / sy,
      }))
      .filter(
        (p) =>
          Number.isFinite(p.x) && Number.isFinite(p.y) &&
          p.x >= x0 / sx - 10 && p.x <= x1 / sx + 10 &&
          p.y >= y0 / sy - 10 && p.y <= y1 / sy + 10,
      );
    if (ring.length < 3) return { ring: null };
    const clean = simplify(ring, 2.5);
    if (clean.length < 3) return { ring: null };
    if (ringArea(clean) < 400) return { ring: null }; // sliver / shadow line
    if (parcel) {
      const cx = clean.reduce((a, p) => a + p.x, 0) / clean.length;
      const cy = clean.reduce((a, p) => a + p.y, 0) / clean.length;
      // The whole point is the SUBJECT house — off-parcel output is a
      // miss, not a result.
      if (!inRing({ x: cx, y: cy }, parcel)) return { ring: null };
    }
    return { ring: clean };
  } catch (e) {
    console.warn(
      "[building-footprint] vision extraction failed",
      e instanceof Error ? e.message : e,
    );
    return { ring: null };
  }
}
