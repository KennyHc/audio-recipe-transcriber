import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Play } from "lucide-react";
import { RecipeThumbnail } from "./PublicRecipeCard";

// The creator's video, embedded from youtube-nocookie.com through the YouTube IFrame Player API
// (needed for seeking). Lazy: nothing from YouTube loads until the player scrolls into view or
// someone presses play / a timestamp. If the creator disabled embedding, `onUnavailable` fires
// and the page falls back to links.

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
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
  /** Seeks to `seconds` of the original video and plays (starting the player if needed). */
  seek(seconds: number): void;
}

export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  {
    videoId: string;
    startSeconds: number;
    thumbnailUrl: string | null;
    title: string;
    onUnavailable: () => void;
  }
>(function YouTubePlayer({ videoId, startSeconds, thumbnailUrl, title, onUnavailable }, ref) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Start the player once it's on screen.
  useEffect(() => {
    const el = wrapperRef.current;
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

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      wrapperRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
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

  return (
    <div
      ref={wrapperRef}
      className="relative aspect-video w-full overflow-hidden rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--sunken))]"
    >
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
  );
});
