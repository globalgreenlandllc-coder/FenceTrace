/**
 * Canvas geometry constants shared by BOTH the client takeoff canvas
 * and the SERVER-ONLY plan→estimate converter.
 *
 * IMPORTANT: this module must NOT carry a "use client" or "server-only"
 * directive. The takeoff canvas lives in aerial-shared.tsx, which is a
 * "use client" module. When a server module (lib/ai/blueprint-to-estimate.ts)
 * imports a *value* export from a "use client" module, the React Server
 * Components bundler replaces that export with a client *reference* — so
 * on the server `PX_PER_FT` reads as an opaque object, not `2.4`. Every
 * `feet × PX_PER_FT` / `PX_PER_FT ÷ pdfPxPerFt` then silently evaluates
 * to NaN, which collapsed both the feet-aware projection and the
 * rectangular-layout synthesizer: the canvas rendered nothing, the legend
 * showed "Eaves NaN LF", and the nine downspouts stacked into a single
 * dot at the viewBox center.
 *
 * Keeping the raw numbers in a directive-free module lets both the client
 * canvas and the server converter import a real `2.4`.
 */
export const VIEWBOX_W = 900;
export const VIEWBOX_H = 580;
export const PX_PER_FT = 2.4;
