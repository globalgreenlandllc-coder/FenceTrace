"use client";

import { useEffect, useRef, useState } from "react";
import {
  Headphones,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Hear your proposal" — the voice-note hero of the client portal.
 *
 * Visually it's the ONE dark card on a white page: a big pulsing play
 * button a thumb can't miss, live equalizer bars while it speaks, a
 * chunky scrubbable progress bar, ±10s skips and speed chips — sized
 * for a phone held in one hand in a truck.
 *
 * Mechanics unchanged from the original card: the audio file is
 * fetched lazily from /api/p/[token]/audio on the first tap (a user
 * gesture, so mobile autoplay policies are satisfied), MediaSession
 * metadata puts it on the lock screen / CarPlay, and the email's
 * ?listen=1 deep link scrolls here and pulses the ring — but never
 * autoplays, browsers block sound without a tap.
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
  const [rate, setRate] = useState(1);
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

  function setSpeed(next: number) {
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
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
      el.playbackRate = rate;
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
  const playing = status === "playing";

  return (
    <div
      ref={cardRef}
      className={cn(
        "transition-smooth relative overflow-hidden rounded-2xl p-5 text-white shadow-card sm:p-6",
        highlight && "ring-4 ring-accent-300",
      )}
      style={{
        background:
          "linear-gradient(125deg, #0D1B12 0%, #14351F 55%, #1E7340 130%)",
      }}
    >
      {/* soft glow behind the button */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-10 -top-14 h-48 w-48 rounded-full bg-accent-500/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_right,black,transparent_70%)]"
      />

      <div className="relative flex items-center gap-4 sm:gap-5">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={status === "loading"}
          aria-label={
            playing ? "Pause the audio summary" : "Play the audio summary"
          }
          className={cn(
            "press-scale ring-focus-dark flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-accent-800 shadow-lg transition-smooth hover:bg-accent-50 disabled:opacity-70 sm:h-[4.5rem] sm:w-[4.5rem]",
            status === "idle" && "listen-pulse",
          )}
        >
          {status === "loading" ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : playing ? (
            <Pause className="h-7 w-7" />
          ) : status === "error" ? (
            <RotateCcw className="h-7 w-7" />
          ) : (
            <Play className="ml-1 h-8 w-8" fill="currentColor" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Headphones className="h-4 w-4 shrink-0 text-accent-300" />
            <span className="text-[17px] font-bold tracking-tight sm:text-lg">
              Hear your proposal
            </span>
            {/* live equalizer — only once playback has started */}
            {started && (
              <span
                aria-hidden
                className="ml-1 flex h-4 items-end gap-[3px]"
              >
                {[0.9, 0.55, 1, 0.4, 0.75].map((h, i) => (
                  <span
                    key={i}
                    className={cn("eq-bar w-[3px] rounded-full bg-accent-300", !playing && "eq-paused")}
                    style={{ height: `${h * 100}%`, animationDelay: `${i * 0.13}s` }}
                  />
                ))}
              </span>
            )}
            {duration > 0 && !started && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">
                {formatTime(duration)}
              </span>
            )}
          </div>

          {status === "error" ? (
            <p className="mt-1.5 text-[13px] leading-snug text-rose-300">
              {error} — tap to try again.
            </p>
          ) : !started ? (
            <p className="mt-1 text-[13px] leading-snug text-white/70">
              Tap play — the scope, your options and the price, read aloud in
              about a minute. Works with the screen off.
            </p>
          ) : (
            <div className="mt-2.5">
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
                className="ring-focus-dark h-2.5 w-full cursor-pointer rounded-full bg-white/15"
              >
                <div
                  className="relative h-full rounded-full bg-gradient-to-r from-accent-400 to-accent-300"
                  style={{ width: `${Math.max(1.5, progress * 100)}%` }}
                >
                  <span className="absolute -right-1.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow" />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="tabular-nums text-xs text-white/70">
                  {formatTime(progress * duration)} / {formatTime(duration)}
                </span>
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => skipBy(-10)}
                    aria-label="Back 10 seconds"
                    className="ring-focus-dark flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-smooth hover:bg-white/20"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => skipBy(10)}
                    aria-label="Forward 10 seconds"
                    className="ring-focus-dark flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-smooth hover:bg-white/20"
                  >
                    <RotateCw className="h-4 w-4" />
                  </button>
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {[1, 1.25, 1.5].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSpeed(r)}
                      aria-label={`Play at ${r}x speed`}
                      className={cn(
                        "ring-focus-dark rounded-full px-2.5 py-1.5 text-[11px] font-bold tabular-nums transition-smooth",
                        rate === r
                          ? "bg-white text-accent-900"
                          : "bg-white/10 text-white/75 hover:bg-white/20",
                      )}
                    >
                      {r}×
                    </button>
                  ))}
                </span>
              </div>
            </div>
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
