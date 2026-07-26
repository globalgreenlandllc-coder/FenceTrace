"use client";

import { useEffect, useRef, useState } from "react";

import { VIEWBOX_W, VIEWBOX_H } from "./aerial-constants";

/**
 * Rasterize one page of the source PDF (client-side, via pdfjs) and paint
 * it as an SVG <image> filling the takeoff viewBox — so the contractor
 * traces gutters on the architect's REAL roof-plan sheet ("an exact copy
 * of the roof") instead of a schematic redraw. Lives inside the same SVG
 * as the trace, so the canvas pan/zoom applies to it too.
 *
 * Renders null while loading or on any failure; the parent paints a
 * BlueprintBackground underneath, so the worst case is the old drafting-
 * paper look (never a broken canvas). The loaded document + each rendered
 * page are cached at module scope, so flipping sheets / re-opening the
 * takeoff is instant and never re-downloads.
 */

// pdfUrl -> loaded PDFDocumentProxy promise
const docCache = new Map<string, Promise<unknown>>();
// `${pdfUrl}#${page}` -> rendered PNG data URL
const pageCache = new Map<string, string>();

export function PdfPageImage({
  pdfUrl,
  pageIndex,
  onState,
}: {
  pdfUrl: string;
  pageIndex: number;
  /** Lets the parent show a spinner / fall back without re-rendering us. */
  onState?: (s: "loading" | "ready" | "error") => void;
}) {
  const cacheKey = `${pdfUrl}#${pageIndex}`;
  const [dataUrl, setDataUrl] = useState<string | null>(
    () => pageCache.get(cacheKey) ?? null,
  );
  const reqRef = useRef(0);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    const key = `${pdfUrl}#${pageIndex}`;
    const cached = pageCache.get(key);
    if (cached) {
      setDataUrl(cached);
      onStateRef.current?.("ready");
      return;
    }
    setDataUrl(null);
    onStateRef.current?.("loading");
    const myReq = ++reqRef.current;
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Worker pinned to the installed version; .mjs loads as a module
        // worker. Set once (idempotent).
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        }

        let docPromise = docCache.get(pdfUrl);
        if (!docPromise) {
          docPromise = pdfjs.getDocument({
            url: pdfUrl,
            withCredentials: true, // owner-scoped endpoint behind Clerk auth
          }).promise;
          docCache.set(pdfUrl, docPromise);
        }
        const doc = (await docPromise) as Awaited<
          ReturnType<typeof pdfjs.getDocument>["promise"]
        >;

        const pageNum = Math.min(Math.max(1, pageIndex), doc.numPages);
        const page = await doc.getPage(pageNum);

        // Render at ~1700px wide — crisp when zoomed into the canvas.
        const unit = page.getViewport({ scale: 1 });
        const scale = Math.min(4, 1700 / unit.width);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        // PDF pages are transparent — paint white so it reads as paper.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const url = canvas.toDataURL("image/png");

        if (cancelled || myReq !== reqRef.current) return;
        pageCache.set(key, url);
        setDataUrl(url);
        onStateRef.current?.("ready");
      } catch (e) {
        if (cancelled || myReq !== reqRef.current) return;
        // Drop the doc promise so a retry (different page) can re-fetch.
        docCache.delete(pdfUrl);
        console.warn("[PdfPageImage] render failed:", e);
        setDataUrl(null);
        onStateRef.current?.("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl, pageIndex]);

  if (!dataUrl) return null;
  return (
    <image
      href={dataUrl}
      x={0}
      y={0}
      width={VIEWBOX_W}
      height={VIEWBOX_H}
      preserveAspectRatio="xMidYMid meet"
      pointerEvents="none"
    />
  );
}
