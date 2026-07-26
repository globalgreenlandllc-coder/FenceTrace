"use client";

import { useRef } from "react";
import { Upload, X } from "lucide-react";
import type { Proposal } from "@/lib/proposal-mock";
import { PhotoTile } from "./photo-tile";
import { SectionHeader } from "./packages-section";

const TONES = ["front", "side", "back", "detail"] as const;

export function PhotosSection({
  proposal,
  onChange,
  readOnly,
}: {
  proposal: Proposal;
  onChange: (p: Proposal) => void;
  readOnly?: boolean;
}) {
  const dropRef = useRef<HTMLDivElement>(null);

  function addPlaceholder() {
    const id = `p-${Date.now()}`;
    const tone = TONES[proposal.photos.length % TONES.length];
    onChange({
      ...proposal,
      photos: [...proposal.photos, { id, caption: "Site photo", tone }],
    });
  }

  function remove(id: string) {
    onChange({
      ...proposal,
      photos: proposal.photos.filter((p) => p.id !== id),
    });
  }

  function setCaption(id: string, caption: string) {
    onChange({
      ...proposal,
      photos: proposal.photos.map((p) =>
        p.id === id ? { ...p, caption } : p,
      ),
    });
  }

  return (
    <section data-section="photos" className="space-y-4">
      <SectionHeader
        title="Site photos"
        sub="Show the homeowner exactly what you saw on site."
        readOnly={readOnly}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {proposal.photos.map((photo) => (
          <div key={photo.id} className="group relative">
            <PhotoTile photo={photo} className="aspect-[4/3]" />
            {!readOnly && (
              <>
                <input
                  value={photo.caption}
                  onChange={(e) => setCaption(photo.id, e.target.value)}
                  className="absolute inset-x-2 bottom-2 rounded-md border border-zinc-200 bg-white/95 px-2 py-1 text-xs text-zinc-900 outline-none transition-smooth focus:border-accent-500 focus:ring-2 focus:ring-accent-500/15"
                />
                <button
                  type="button"
                  onClick={() => remove(photo.id)}
                  className="ring-focus absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white/95 text-zinc-600 opacity-0 transition-smooth hover:border-rose-300 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label="Remove photo"
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        ))}

        {!readOnly && (
          <div
            ref={dropRef}
            onClick={addPlaceholder}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addPlaceholder();
            }}
            className="group active:scale-[0.98] flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-white text-xs text-zinc-500 transition-smooth hover:border-accent-400 hover:bg-accent-50/40 hover:text-accent-700"
          >
            <Upload className="h-5 w-5 transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none" />
            <span>Drop or tap to add photo</span>
          </div>
        )}
      </div>
    </section>
  );
}
