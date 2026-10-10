import { forwardRef, useEffect, useImperativeHandle, useReducer, useRef, useState } from "react";
import { ArrowUp, Play, X } from "lucide-react";
import { INITIAL_MINI_PLAYER, miniPlayerReducer, slotInView, SLOT_VISIBLE_RATIO } from "@/lib/miniPlayer";
import { cn } from "@/lib/utils";
import { RecipeThumbnail } from "./PublicRecipeCard";

// The creator's video, embedded from youtube-nocookie.com through the YouTube IFrame Player API
// (needed for seeking). Lazy: nothing from YouTube loads until the player scrolls into view or
// someone presses play / a timestamp. If the creator disabled embedding, `onUnavailable` fires
// and the page falls back to links.
//
// Mini player (lib/miniPlayer.ts): while playing and scrolled out of view — or when a timestamp
// is clicked out of view — the same player element floats in a corner (CSS only; the iframe is
// never moved, so it doesn't reload), and the in-flow slot keeps its height so nothing jumps.

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    options: {
      host?: string;
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
        onStateChange?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("Couldn't load the video player."));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export interface YouTubePlayerHandle {
  /** Seeks to `seconds` of the original video and plays (starting the player if needed). Never
   * scrolls: out of view, the player floats as a mini player instead. */
  seek(seconds: number): void;
}

/** YT.PlayerState */
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_ENDED = 0;

const TOP_BAR_PX = 56;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  {
    videoId: string;
    startSeconds: number;
    thumbnailUrl: string | null;
    title: string;
    onUnavailable: () => void;
    /** Something covers the page (cook mode): pause and dock. */
    suspended?: boolean;
  }
>(function YouTubePlayer({ videoId, startSeconds, thumbnailUrl, title, onUnavailable, suspended = false }, ref) {
  const slotRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mini, dispatch] = useReducer(miniPlayerReducer, INITIAL_MINI_PLAYER);
  const floating = mini.mode === "floating";

  // Start the player once it's near the screen.
  useEffect(() => {
    const el = slotRef.current;
    if (!el || active || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setActive(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [active]);

  // Track whether the in-flow slot (not the floating player) is on screen, below the top bar.
  useEffect(() => {
    const el = slotRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) dispatch({ type: "visibility", inView: slotInView(entry) });
      },
      { rootMargin: `-${TOP_BAR_PX}px 0px 0px 0px`, threshold: [0, SLOT_VISIBLE_RATIO, 0.6, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!active || !mountRef.current) return;
    let cancelled = false;
    const target = document.createElement("div");
    mountRef.current.appendChild(target);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        const start = pendingSeekRef.current ?? startSeconds;
        playerRef.current = new YT.Player(target, {
          host: "https://www.youtube-nocookie.com",
          videoId,
          width: "100%",
          height: "100%",
          playerVars: { start: Math.floor(start), autoplay: autoplay ? 1 : 0, rel: 0, playsinline: 1, modestbranding: 1 },
          events: {
            onReady: (e) => {
              readyRef.current = true;
              const pending = pendingSeekRef.current;
              pendingSeekRef.current = null;
              if (pending !== null && pending !== start) {
                e.target.seekTo(pending, true);
                e.target.playVideo();
              }
            },
            onStateChange: (e) => {
              if (e.data === YT_PLAYING) dispatch({ type: "playing", playing: true });
              else if (e.data === YT_PAUSED || e.data === YT_ENDED) dispatch({ type: "playing", playing: false });
            },
            onError: (e) => {
              // 101 / 150: the owner doesn't allow embedding; 100: removed or private.
              if (e.data === 100 || e.data === 101 || e.data === 150) onUnavailable();
            },
          },
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load the video player.");
      });
    return () => {
      cancelled = true;
      readyRef.current = false;
      playerRef.current?.destroy();
      playerRef.current = null;
      target.remove();
    };
    // `autoplay` and `startSeconds` are read once, when the player is created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, videoId]);

  function pause() {
    if (playerRef.current && readyRef.current) playerRef.current.pauseVideo();
    pendingSeekRef.current = null;
  }

  // Cook mode covers the page: don't keep playing (or floating) underneath it.
  useEffect(() => {
    if (!suspended) return;
    pause();
    dispatch({ type: "covered" });
  }, [suspended]);

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      dispatch({ type: "seek" });
      if (playerRef.current && readyRef.current) {
        playerRef.current.seekTo(seconds, true);
        playerRef.current.playVideo();
        return;
      }
      pendingSeekRef.current = seconds;
      setAutoplay(true);
      setActive(true);
    },
  }));

  function close() {
    pause();
    dispatch({ type: "close" });
  }

  function backToVideo() {
    slotRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  }

  return (
    <div ref={slotRef} className="relative aspect-video w-full" data-mini-player={mini.mode}>
      {floating && (
        // Placeholder in the slot while the player floats (same height — the slot keeps it).
        <div className="absolute inset-0 overflow-hidden rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--sunken))]">
          <RecipeThumbnail src={thumbnailUrl} className="h-full opacity-30" />
          <button
            type="button"
            onClick={backToVideo}
            className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm font-medium text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))]"
          >
            Playing in the mini player
          </button>
        </div>
      )}

      {/* The player itself: docked (fills the slot) or floating (fixed). Never re-parented. */}
      <div
        role={floating ? "region" : undefined}
        aria-label={floating ? "Mini video player" : undefined}
        className={cn(
          "overflow-hidden rounded-[10px] border border-[hsl(var(--border))]",
          floating
            ? "mini-player-in fixed z-[45] right-3 w-[46vw] min-w-[168px] bg-[hsl(var(--surface))] shadow-[var(--shadow-float)] sm:right-4 sm:w-[320px] border-[hsl(var(--border-strong))]"
            : "absolute inset-0 bg-[hsl(var(--sunken))]",
        )}
        style={floating ? { bottom: "calc(12px + env(safe-area-inset-bottom, 0px))" } : undefined}
      >
        <div
          className={cn(
            "items-center justify-between gap-1 border-b border-[hsl(var(--border))] px-1 py-0.5",
            floating ? "flex" : "hidden",
          )}
        >
          <button
            type="button"
            onClick={backToVideo}
            className="inline-flex h-7 min-w-0 items-center gap-1 rounded-[6px] px-1.5 text-xs font-medium text-[hsl(var(--accent-text))] hover:bg-[hsl(var(--accent-tint))]"
          >
            <ArrowUp className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Back to video</span>
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Close mini player"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[hsl(var(--ink-muted))] hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative aspect-video w-full">
          <div ref={mountRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
          {!active && (
            <button
              type="button"
              onClick={() => {
                setAutoplay(true);
                setActive(true);
              }}
              aria-label={`Play “${title}”`}
              className="group absolute inset-0"
            >
              <RecipeThumbnail src={thumbnailUrl} className="h-full" />
              <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgb(15_27_45_/_0.7)] text-white transition-transform group-hover:scale-105">
                <Play className="h-6 w-6 translate-x-[1px] fill-current" />
              </span>
            </button>
          )}
          {loadError && (
            <p className="absolute inset-x-0 bottom-0 bg-[hsl(var(--surface)/0.9)] px-3 py-2 text-xs text-[hsl(var(--danger))]">
              {loadError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});
