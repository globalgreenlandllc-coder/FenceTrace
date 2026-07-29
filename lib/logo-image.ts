/**
 * logo-image.ts — turn whatever the contractor picked into a logo we can
 * actually store.
 *
 * Brand logos live inline on the contractor profile as a data URL (see
 * validateLogoUrl in app/actions/me.ts), which is what put a hard size
 * ceiling on the upload. Rejecting the file was the wrong end of the
 * problem: a logo is rendered at 32–120 px in the nav, the proposal cover
 * and the client portal, so a 12-megapixel phone photo of a truck door is
 * not "too big", it's just un-resized.
 *
 * So: decode anything the browser can decode, draw it down to at most
 * LOGO_MAX_EDGE, and step quality (then dimensions) until the encoded
 * data URL fits the budget. A 723 KB JPEG lands around 30 KB; a 20 MB PNG
 * lands in the same place. The only real failure left is a file the
 * browser has no decoder for (HEIC outside Safari, RAW, TIFF), which is
 * reported as such instead of as a size problem.
 *
 * Browser-only — uses canvas. Call it from client components.
 */

/** Longest edge we keep. The largest on-screen use is the proposal cover
 *  at ~120 px CSS, so 512 covers 3× retina with room to spare. */
export const LOGO_MAX_EDGE = 512;

/** Data-URL budget. The server accepts 600 000 chars; staying under this
 *  leaves headroom so a round-trip can never trip the server guard. */
export const LOGO_MAX_DATAURL_CHARS = 480_000;

/** An SVG under this stays vector — it scales forever and is usually
 *  smaller than any raster we'd produce from it. */
const SVG_KEEP_VECTOR_BYTES = 96 * 1024;

export type PreparedLogo = {
  dataUrl: string;
  /** Human note about what we did, or null when the file was kept as-is. */
  note: string | null;
};

export class LogoDecodeError extends Error {}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Decode to something drawable. createImageBitmap is faster and handles
 *  big files without a layout pass, but it doesn't do SVG in every
 *  browser — hence the <img> fallback, which does. */
async function decode(
  file: File,
): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function" && !isSvg(file)) {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // A dimensionless SVG (no width/height, no viewBox) decodes to
        // 0×0 and would rasterise to nothing.
        if (!img.naturalWidth || !img.naturalHeight) {
          reject(new LogoDecodeError("no-dimensions"));
          return;
        }
        resolve(img);
      };
      img.onerror = () => reject(new LogoDecodeError("decode-failed"));
      img.src = url;
    });
  } finally {
    // Revoking immediately is safe: decode has already finished.
    URL.revokeObjectURL(url);
  }
}

function isSvg(file: File): boolean {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
}

/** Source formats that can carry transparency — a logo on a transparent
 *  background must not be flattened onto black by a JPEG fallback. */
function mayHaveAlpha(file: File): boolean {
  return !/^image\/jpe?g$/i.test(file.type);
}

function drawTo(
  src: CanvasImageSource & { width: number; height: number },
  edge: number,
  matte: string | null,
): HTMLCanvasElement {
  const scale = Math.min(1, edge / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new LogoDecodeError("no-canvas");
  ctx.imageSmoothingQuality = "high";
  if (matte) {
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

/** toDataURL silently falls back to PNG for a MIME the browser can't
 *  encode, so the result has to be checked rather than trusted. */
function encode(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): string | null {
  const url = canvas.toDataURL(type, quality);
  return url.startsWith(`data:${type}`) ? url : null;
}

/**
 * Prepare any picked file for storage as a brand logo. Throws
 * LogoDecodeError only when the browser cannot decode the image at all.
 */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  // Vector stays vector when it's already small — rasterising a crisp SVG
  // to 512 px would be a downgrade, not a fix.
  if (isSvg(file) && file.size <= SVG_KEEP_VECTOR_BYTES) {
    const text = await readAsText(file);
    const dataUrl = `data:image/svg+xml;base64,${btoa(
      // btoa is latin1-only; SVGs routinely carry UTF-8 (® ™ accents).
      String.fromCharCode(...new TextEncoder().encode(text)),
    )}`;
    if (dataUrl.length <= LOGO_MAX_DATAURL_CHARS) {
      return { dataUrl, note: null };
    }
    // Too big even as text — fall through and rasterise it.
  }

  const src = await decode(file);

  const alpha = mayHaveAlpha(file);
  // WebP honours quality AND keeps alpha, so it's the first choice
  // everywhere it encodes. PNG is the alpha-safe fallback (quality is
  // ignored, so it only shrinks with dimensions); JPEG is last and needs
  // a white matte because it has no alpha channel at all.
  const attempts: { type: string; matte: string | null }[] = alpha
    ? [
        { type: "image/webp", matte: null },
        { type: "image/png", matte: null },
        { type: "image/jpeg", matte: "#ffffff" },
      ]
    : [
        { type: "image/webp", matte: null },
        { type: "image/jpeg", matte: null },
      ];

  const edges = [LOGO_MAX_EDGE, 384, 288, 208, 144];
  const qualities = [0.92, 0.82, 0.7, 0.58, 0.45];

  for (const edge of edges) {
    for (const { type, matte } of attempts) {
      const canvas = drawTo(src, edge, matte);
      for (const q of qualities) {
        const url = encode(canvas, type, q);
        if (!url) break; // this browser can't encode that type at all
        if (url.length <= LOGO_MAX_DATAURL_CHARS) {
          const changed =
            edge < Math.max(src.width, src.height) ||
            !`data:${file.type}`.startsWith(`data:${type}`);
          return {
            dataUrl: url,
            note: changed
              ? `Resized ${src.width}×${src.height} · ${kb(file.size)} → ${canvas.width}×${canvas.height} · ${kb((url.length * 3) / 4)}`
              : null,
          };
        }
        // PNG ignores quality — retrying it at a lower one is wasted work.
        if (type === "image/png") break;
      }
    }
  }

  // Nothing fit, which for a 144 px image means the browser only offered
  // PNG on a very noisy source. Take the smallest thing we can make.
  const last = drawTo(src, 96, alpha ? null : "#ffffff");
  const url = last.toDataURL("image/png");
  if (url.length > LOGO_MAX_DATAURL_CHARS) {
    throw new LogoDecodeError("too-detailed");
  }
  return {
    dataUrl: url,
    note: `Resized ${src.width}×${src.height} · ${kb(file.size)} → ${last.width}×${last.height} · ${kb((url.length * 3) / 4)}`,
  };
}

/** Message for a file the browser could not turn into an image. */
export function logoDecodeMessage(file: File): string {
  const ext = file.name.split(".").pop()?.toUpperCase() ?? "";
  const known = [
    "HEIC",
    "HEIF",
    "TIFF",
    "TIF",
    "CR2",
    "NEF",
    "ARW",
    "DNG",
    "PSD",
    "AI",
    "EPS",
  ];
  if (known.includes(ext)) {
    return `Your browser can't open ${ext} files. Export it as PNG or JPEG and upload that — any size is fine.`;
  }
  return "That file couldn't be read as an image. Try a PNG, JPEG, WebP, or SVG — any size is fine.";
}

/** Read a file straight through with no processing (used for the "keep
 *  the original" path in tests and non-image callers). */
export const readFileAsDataUrl = readAsDataUrl;
