import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Play, Pause, RotateCcw, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import { formatTimestamp } from "@/lib/format";

export const AudioPlayer = forwardRef<
  HTMLAudioElement,
  { jobId: string; title: string; activeStepText?: string | null }
>(function AudioPlayer({ jobId, title, activeStepText }, forwardedRef) {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  useImperativeHandle(forwardedRef, () => audioElRef.current as HTMLAudioElement, []);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onDuration = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", onDuration);
    el.addEventListener("loadedmetadata", onDuration);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", onDuration);
      el.removeEventListener("loadedmetadata", onDuration);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, []);

  function togglePlay() {
    const el = audioElRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {
        /* autoplay may be blocked */
      });
    } else {
      el.pause();
    }
  }

  function skip(delta: number) {
    const el = audioElRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min((duration || el.duration || 0) + 1, el.currentTime + delta));
  }

  function scrubTo(fraction: number) {
    const el = audioElRef.current;
    if (!el || !duration) return;
    el.currentTime = fraction * duration;
  }

  const progressFraction = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <div className="no-print fixed inset-x-0 bottom-3 z-30 px-3">
      <audio ref={audioElRef} src={api.audioUrl(jobId)} preload="metadata" className="hidden" />
      <div
        className="mx-auto flex max-w-[720px] items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] py-1.5 pl-1.5 pr-4 sm:gap-3"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent-fill))] text-white transition-opacity hover:opacity-90"
        >
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
        </button>

        <button
          type="button"
          onClick={() => skip(-10)}
          aria-label="Back 10 seconds"
          className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[hsl(var(--ink-muted))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => skip(10)}
          aria-label="Forward 10 seconds"
          className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[hsl(var(--ink-muted))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>

        <span className="shrink-0 text-xs tabular-nums text-[hsl(var(--ink-muted))]">
          {formatTimestamp(current)} / {formatTimestamp(duration)}
        </span>

        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={1}
          step={0.001}
          value={progressFraction}
          onChange={(e) => scrubTo(Number(e.target.value))}
          className="h-1 flex-1 min-w-[3rem] cursor-pointer appearance-none rounded-full bg-[hsl(var(--border))] accent-[hsl(var(--accent-fill))]"
          style={{
            background: `linear-gradient(to right, hsl(var(--accent-fill)) ${progressFraction * 100}%, hsl(var(--border)) ${progressFraction * 100}%)`,
          }}
        />

        <span
          className="hidden md:block shrink-0 max-w-[14rem] truncate text-xs text-[hsl(var(--ink-muted))]"
          title={activeStepText ?? title}
        >
          {activeStepText ?? title}
        </span>
      </div>
    </div>
  );
});
