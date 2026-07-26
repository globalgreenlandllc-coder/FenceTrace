"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, Loader2, Pause, Play, RotateCcw } from "lucide-react";

/**
 * "Listen to this quote" — plays the server-generated TTS summary of the
 * proposal (scope, package prices, deposit, validity) for a client who
 * can't read the page right now, e.g. driving. The audio file is fetched
 * lazily from /api/p/[token]/audio on the first tap (a user gesture, so
 * mobile autoplay policies are satisfied) and the MediaSession metadata
 * makes the lock screen / CarPlay show it as a controllable track, so
 * playback survives the screen turning off.
 *
 * The email deep-links here with ?listen=1: we scroll the card into view
 * and pulse it, but never autoplay — browsers block sound without a tap.
 */
export function ListenCard({
  token,
  address,
  company,
}: {
  token: string;
  address: string;
  company: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "playing" | "paused" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0); // 0..1
  const [duration, setDuration] = useState(0); // seconds
  const [highlight, setHighlight] = useState(false);

  useEffect(() => {
    const wantsListen =
      new URLSearchParams(window.location.search).get("listen") === "1";
    if (!wantsListen) return;
    setHighlight(true);
    const scroll = setTimeout(
      () =>
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
      400,
    );
    const calm = setTimeout(() => setHighlight(false), 4000);
    return () => {
      clearTimeout(scroll);
      clearTimeout(calm);
    };
  }, []);

  function setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `Your fence quote — ${address}`,
      artist: company,
    });
    navigator.mediaSession.setActionHandler("play", () => {
      void audioRef.current?.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      audioRef.current?.pause();
    });
    navigator.mediaSession.setActionHandler("seekbackward", () => skipBy(-10));
    navigator.mediaSession.setActionHandler("seekforward", () => skipBy(10));
  }

  function skipBy(seconds: number) {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + seconds));
  }

  async function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.src && status !== "error") {
      if (el.paused) void el.play();
      else el.pause();
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/p/${encodeURIComponent(token)}/audio`);
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; url?: string; reason?: string }
        | null;
      if (!res.ok || !body?.ok || !body.url) {
        throw new Error(body?.reason || "Couldn't load the audio summary.");
      }
      el.src = body.url;
      await el.play();
    } catch (e) {
      setStatus("error");
      setError(
        e instanceof Error ? e.message : "Couldn't load the audio summary.",
      );
    }
  }

  function seekTo(clientX: number, bar: HTMLDivElement) {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    setProgress(ratio);
  }

  const started = status === "playing" || status === "paused";

  return (
    <div
      ref={cardRef}
      className={`transition-smooth rounded-2xl border bg-white p-5 shadow-card ${
        highlight
          ? "border-accent-400 ring-2 ring-accent-300"
          : "border-zinc-200"
      }`}
    >
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={status === "loading"}
          aria-label={
            status === "playing" ? "Pause the audio summary" : "Play the audio summary"
          }
          className="press-scale ring-focus flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white shadow-sm hover:bg-accent-700 disabled:opacity-70"
        >
          {status === "loading" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : status === "playing" ? (
            <Pause className="h-5 w-5" />
          ) : status === "error" ? (
            <RotateCcw className="h-5 w-5" />
          ) : (
            <Play className="ml-0.5 h-5 w-5" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Headphones className="h-4 w-4 shrink-0 text-accent-600" />
            <div className="truncate text-sm font-semibold text-zinc-900">
              Listen to this quote
            </div>
          </div>
          {status === "error" ? (
            <p className="mt-1 text-xs text-red-600">{error}</p>
          ) : started ? (
            <div className="mt-2 flex items-center gap-3">
              <div
                role="slider"
                aria-label="Playback position"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                tabIndex={0}
                onClick={(e) => seekTo(e.clientX, e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") skipBy(-10);
                  if (e.key === "ArrowRight") skipBy(10);
                }}
                className="ring-focus h-1.5 flex-1 cursor-pointer rounded-full bg-zinc-200"
              >
                <div
                  className="h-full rounded-full bg-accent-600"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <span className="shrink-0 tabular-nums text-[11px] text-zinc-500">
                {formatTime(progress * duration)} / {formatTime(duration)}
              </span>
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-zinc-500">
              On the road? Hear the scope, your options, and pricing in about a
              minute.
            </p>
          )}
        </div>
      </div>

      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onPlay={() => {
          setStatus("playing");
          setupMediaSession();
        }}
        onPause={() =>
          setStatus((s) => (s === "error" || s === "loading" ? s : "paused"))
        }
        onEnded={() => {
          setStatus("paused");
          setProgress(1);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration > 0) setProgress(el.currentTime / el.duration);
        }}
        onError={(e) => {
          if (!e.currentTarget.src) return; // no source yet — not an error
          setStatus("error");
          setError("Playback failed — please try again.");
        }}
      />
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
