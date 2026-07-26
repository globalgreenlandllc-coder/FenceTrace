# Roof-engine v2 — "classify, don't trace"

## Why v1 keeps failing

v1 asks the AI to **draw geometry**: freehand gutter runs in pixel space, then
we swap in the vector footprint, remap the AI's coordinates onto it, re-anchor
the scale from prose, and let a closure step price whatever the AI didn't
cover at a blind "continuous gutters @ all eaves" default. Every one of those
seams has produced a production bug:

- freehand runs don't tile the perimeter → closure prices 10–13 edges blind
  (+109…+184 LF of invented gutter, some of it across gable faces);
- scale anchored to a bbox that over-reaches through dimension leaders
  (24 pt/ft vs the sheet's real geometry) → every length reads wrong;
- geometry and classification arrive in different coordinate spaces and have
  to be reconciled — the reconciliation is where the errors live.

**The model was never the right tool for geometry. It is the right tool for
reading labels.** The plan set already states every fact we need, drawn as
outlined glyphs only vision can read (Woodinville A9): `GABLE END TRUSS` on
every gable wall, `LINE OF CONTINUOUS METAL GUTTER, TYP.`, `BARGE BOARD @
GABLE ENDS & RAKES`, `D.S.` at each downspout, `2'-0" O.H. TYP.`, ridge/valley
lines, truss directions per block, and printed dimension strings.

## v2 architecture

**Geometry is deterministic. AI answers multiple-choice questions about edges
WE define. It never outputs a coordinate.**

1. **Exact outline (deterministic, exists today).** Vector-extract the roof
   sheet's fascia outline (width-tiered flood fill, frame peel) → polygon
   E1…En. On a roof plan the outer boundary IS the fascia = the gutter line,
   so eave LF is exact once classified.

2. **Annotated overlay (deterministic, `lib/ai/plan-overlay.ts`).** Render the
   extracted linework with the outline emphasized and every edge tagged with a
   chip (E1…En), plus candidate dimension spans tagged D1…Dk. SVG → PNG via
   sharp.

3. **One expensive vision call (`lib/ai/classify-edges.ts`).** Overlay PNG +
   the original PDF. Structured tool output, keyed by OUR ids:
   - per edge: `eave | rake | unknown`, tier, feature, evidence tags
     (gable-end-truss label, gutter callout, barge/rake callout, elevation
     gable, elevation eave line, truss direction);
   - downspouts: `{edge_id, frac}` from the sheet's `D.S.` marks + elevation
     downspout lines;
   - dimension values: printed feet for each D-chip → `ptPerFt = spanPt/feet`
     per candidate, median of consistent candidates
     (`lib/ai/dim-scale.ts`). Never trust the title-block scale note — PDFs
     get exported at arbitrary sizes; a measured dimension line cannot lie.
   - ridge-direction hints per block (from truss line direction) for the
     drawn diagram.

4. **Deterministic takeoff (`lib/ai/edge-takeoff.ts`).** eave LF = Σ eave-edge
   lengths × exact scale. Corners from polygon turns. Downspouts at the
   marked positions. Rakes drawn as gable edges. **No closure default:**
   an `unknown` edge is flagged UNPRICED for review, never guessed.

5. **Fallback.** `BLUEPRINT_EDGE_TAKEOFF=0` (or any classifier failure) →
   the v1 path, unchanged.

## Cost stance

Owner-approved: correctness over spend. The classifier defaults to the
strongest vision model (`BLUEPRINT_EDGE_MODEL`, default claude-opus-4-8) and
runs once per analysis.

## Generality

Nothing here is Woodinville-specific: every US residential set has a roof
plan or floor plan with a closed outer loop, dimension strings, gable/rake
callouts, and elevations. Sets that lack a readable signal fail LOUD (edges
stay unknown/unpriced) instead of wrong.
