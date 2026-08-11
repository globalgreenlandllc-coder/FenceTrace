"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, PenLine, Type as TypeIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// A handwriting-style stack so a typed name reads as a signature. These are
// system fonts (no web-font load), so the on-screen cursive preview and the
// rendered image stay identical to what the signer sees.
const SIGNATURE_FONT =
  '"Snell Roundhand", "Segoe Script", "Bradley Hand", "Brush Script MT", cursive';

// Rasterize a typed name into the same kind of dataURL the draw canvas
// produces, so acceptProposalByToken's contract (a truthy signature string)
// is met identically whether the client draws or types.
function renderTypedSignature(name: string): string | null {
  const text = name.trim();
  if (text.length < 2) return null;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const width = 600;
  const height = 176; // matches the h-44 draw canvas
  const c = document.createElement("canvas");
  c.width = width * dpr;
  c.height = height * dpr;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#14688C";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  // Shrink the font until the whole name fits with margins.
  let size = 56;
  ctx.font = `italic ${size}px ${SIGNATURE_FONT}`;
  while (ctx.measureText(text).width > width - 48 && size > 20) {
    size -= 2;
    ctx.font = `italic ${size}px ${SIGNATURE_FONT}`;
  }
  ctx.fillText(text, width / 2, height / 2 - 4);
  return c.toDataURL();
}

type Mode = "type" | "draw";

export function SignaturePad({
  value,
  onChange,
  signerName,
  onSignerName,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  signerName: string;
  onSignerName: (n: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>("type");
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(!!value);
  // Read from the resize observer, which must not re-subscribe on every
  // stroke (re-running it would wipe the canvas it is meant to preserve).
  const hasInkRef = useRef(hasInk);
  hasInkRef.current = hasInk;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Keep the typed signature image in sync with the name while in type mode.
  useEffect(() => {
    if (mode !== "type") return;
    onChange(renderTypedSignature(signerName));
    // onChange is a stable setState updater from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, signerName]);

  function setupCanvas() {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#14688C";
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
  }

  // (Re)initialize the drawing surface whenever draw mode becomes visible —
  // the canvas is unmounted while typing, so it needs a fresh context.
  // Re-run on RESIZE too: rotating a phone mid-signature changes the
  // canvas width, and assigning width/height wipes the backing store, so
  // the stroke has to be re-drawn into the new box or it vanishes (it
  // used to stretch/disappear, and the parent kept the pre-rotation
  // dataURL as the signature of record).
  useEffect(() => {
    if (mode !== "draw") return;
    const c = canvasRef.current;
    if (!c) return;
    setupCanvas();
    let last = c.getBoundingClientRect();
    const ro = new ResizeObserver(() => {
      const r = c.getBoundingClientRect();
      if (Math.abs(r.width - last.width) < 1) return;
      const old = last;
      last = r;
      const prev = hasInkRef.current ? c.toDataURL() : null;
      setupCanvas();
      if (!prev) return;
      const img = new Image();
      img.onload = () => {
        const ctx = c.getContext("2d");
        // Scale UNIFORMLY, anchored top-left. Stretching to the new width
        // would re-shape the client's handwriting, and this image is the
        // signature of record — better to leave slack at the edge.
        const s = Math.min(r.width / old.width, r.height / old.height);
        // setupCanvas left the context scaled by dpr, so CSS px here.
        ctx?.drawImage(img, 0, 0, old.width * s, old.height * s);
        onChangeRef.current(c.toDataURL());
      };
      img.src = prev;
    });
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function getPos(e: React.PointerEvent): { x: number; y: number } {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent) {
    const c = canvasRef.current;
    if (!c) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setDrawing(true);
    setHasInk(true);
  }

  function move(e: React.PointerEvent) {
    if (!drawing) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function up(e: React.PointerEvent) {
    const c = canvasRef.current;
    if (!c) return;
    // pointercancel (a system gesture stealing the touch) already dropped
    // the capture — releasing an uncaptured pointer throws.
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!drawing) return;
    setDrawing(false);
    onChange(c.toDataURL());
  }

  function clear() {
    if (mode === "draw") {
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext("2d");
        ctx?.clearRect(0, 0, c.width, c.height);
      }
      setHasInk(false);
      onChange(null);
    } else {
      onSignerName("");
      onChange(null);
    }
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    // Leaving draw wipes the stroke; leaving type keeps the name but drops the
    // typed image so the new mode starts from a clean, unambiguous signature.
    setHasInk(false);
    onChange(next === "type" ? renderTypedSignature(signerName) : null);
    setMode(next);
  }

  const typedPreview = signerName.trim();
  const clearDisabled =
    mode === "draw" ? !hasInk : typedPreview.length === 0;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <label className="font-label text-[11px] text-zinc-500">
          Signature
        </label>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
            <button
              type="button"
              onClick={() => switchMode("type")}
              className={cn(
                "transition-smooth ring-focus inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-medium sm:px-2.5 sm:py-1",
                mode === "type"
                  ? "bg-white text-accent-700 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700",
              )}
            >
              <TypeIcon className="h-3 w-3" />
              Type
            </button>
            <button
              type="button"
              onClick={() => switchMode("draw")}
              className={cn(
                "transition-smooth ring-focus inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-medium sm:px-2.5 sm:py-1",
                mode === "draw"
                  ? "bg-white text-accent-700 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700",
              )}
            >
              <PenLine className="h-3 w-3" />
              Draw
            </button>
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={clearDisabled}
            className="transition-smooth press-scale ring-focus inline-flex items-center gap-1 rounded-md border border-zinc-200 px-3 py-2 text-xs text-zinc-600 sm:px-2 sm:py-1 hover:border-rose-300 hover:text-rose-600 disabled:opacity-40"
          >
            <Eraser className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>

      {mode === "draw" ? (
        <div
          className={cn(
            "transition-smooth relative mt-2 overflow-hidden rounded-xl border bg-zinc-50/40",
            hasInk ? "border-accent-300" : "border-zinc-200",
          )}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            className="block h-44 w-full touch-none cursor-crosshair"
          />
          {/* Hint stays mounted and fades — no hard cut when the first
              stroke lands. pointer-events-none keeps drawing unaffected. */}
          <div
            aria-hidden={hasInk}
            className={cn(
              "transition-smooth pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-zinc-400",
              hasInk ? "opacity-0" : "opacity-100",
            )}
          >
            <PenLine className="h-4 w-4" />
            <span className="text-sm">Sign here</span>
          </div>
          <div className="pointer-events-none absolute bottom-2 left-3 right-3 border-t border-dashed border-zinc-300" />
        </div>
      ) : (
        <div
          className={cn(
            "transition-smooth relative mt-2 flex h-44 items-center justify-center overflow-hidden rounded-xl border bg-zinc-50/40 px-4",
            typedPreview ? "border-accent-300" : "border-zinc-200",
          )}
        >
          {typedPreview ? (
            <span
              className="truncate text-accent-800"
              style={{ fontFamily: SIGNATURE_FONT, fontSize: 44 }}
            >
              {typedPreview}
            </span>
          ) : (
            <span className="flex items-center gap-2 text-sm text-zinc-400">
              <TypeIcon className="h-4 w-4" />
              Type your name below to sign
            </span>
          )}
          <div className="pointer-events-none absolute bottom-2 left-3 right-3 border-t border-dashed border-zinc-300" />
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <label className="font-label text-[11px] text-zinc-500">
          {mode === "type" ? "Full name" : "Print name"}
        </label>
        <input
          value={signerName}
          onChange={(e) => onSignerName(e.target.value)}
          placeholder="Your full name"
          className="transition-smooth h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
        />
      </div>
      {mode === "type" && (
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
          Typing your name and accepting counts as your legal electronic
          signature.
        </p>
      )}
    </div>
  );
}
