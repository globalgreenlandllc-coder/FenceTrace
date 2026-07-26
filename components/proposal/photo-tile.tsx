"use client";

import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Photo } from "@/lib/proposal-mock";

const TONES: Record<
  Photo["tone"],
  { from: string; via: string; to: string; accent: string }
> = {
  front: {
    from: "#d2e3f7",
    via: "#bcd6f1",
    to: "#a3c4ea",
    accent: "#0e7490",
  },
  side: {
    from: "#f4e5cf",
    via: "#e9d3ad",
    to: "#dcc093",
    accent: "#b45309",
  },
  back: {
    from: "#dceedb",
    via: "#bfdfbb",
    to: "#a4ce9f",
    accent: "#047857",
  },
  detail: {
    from: "#f4d6dc",
    via: "#ebbcc6",
    to: "#dfa1ae",
    accent: "#9d174d",
  },
};

export function PhotoTile({
  photo,
  className,
}: {
  photo: Photo;
  className?: string;
}) {
  const t = TONES[photo.tone];
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-zinc-200",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, ${t.from} 0%, ${t.via} 50%, ${t.to} 100%)`,
      }}
    >
      <svg
        viewBox="0 0 200 140"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <linearGradient id={`g-${photo.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.accent} stopOpacity="0.18" />
            <stop offset="100%" stopColor={t.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="160" cy="30" r="40" fill={`url(#g-${photo.id})`} />
        <path
          d="M0 110 Q 50 90 100 105 T 200 100 V140 H0 Z"
          fill="rgba(0,0,0,0.10)"
        />
        <path
          d="M40 80 L 100 50 L 160 80 L 160 110 L 40 110 Z"
          fill="rgba(0,0,0,0.18)"
          stroke="rgba(0,0,0,0.12)"
        />
        <rect x="80" y="80" width="14" height="20" fill="rgba(0,0,0,0.28)" />
        <line
          x1="40"
          y1="80"
          x2="160"
          y2="80"
          stroke={t.accent}
          strokeWidth="1.5"
          strokeOpacity="0.7"
        />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
      <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full border border-white/60 bg-white/90 px-2 py-0.5 text-[10px] font-medium text-zinc-700">
        <ImageIcon className="h-2.5 w-2.5" />
        Photo
      </div>
      <div className="absolute inset-x-2 bottom-2 text-xs font-medium text-white drop-shadow">
        {photo.caption}
      </div>
    </div>
  );
}
