// Keeps long-running in-browser processing (model download + transcription) healthy on
// phones: a Screen Wake Lock while active, and a record of how long the tab spent hidden
// (backgrounded tabs get throttled by the browser, which looks like slowness otherwise).
// Generalizes the wake-lock pattern already used by web/src/components/cook/CookMode.tsx.

import { useEffect, useRef, useState } from "react";

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

/**
 * Requests a Screen Wake Lock while `active` is true; releases it when `active` goes false
 * or the component unmounts, and re-acquires it if the page becomes visible again while
 * still active (the OS releases wake locks when a tab is hidden). Silently does nothing if
 * the API is unsupported (older Safari, some WebViews) or the request is rejected (e.g. the
 * user backgrounded the tab before the request settled).
 *
 * Returns whether the lock is currently held, for an optional "Screen stays on" indicator.
 */
export function useWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!active) return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        sentinel = (await nav.wakeLock!.request("screen")) ?? null;
        if (cancelled) {
          sentinel?.release().catch(() => undefined);
          return;
        }
        setHeld(true);
        sentinel?.addEventListener("release", () => setHeld(false));
      } catch {
        setHeld(false);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && !sentinel) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sentinel?.release().catch(() => undefined);
      setHeld(false);
    };
  }, [active]);

  return held;
}

/**
 * Accumulates total seconds the document was hidden (`document.visibilityState === "hidden"`)
 * while `active` is true. Resets to 0 whenever `active` transitions from false to true (a new
 * processing run starts a fresh count). Used to distinguish "slow because the connection is
 * slow" from "slow because the tab was backgrounded" in the end-of-job timing summary.
 */
export function useHiddenTimeTracker(active: boolean): number {
  const [hiddenSeconds, setHiddenSeconds] = useState(0);
  const hiddenSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      hiddenSinceRef.current = null;
      return;
    }
    setHiddenSeconds(0);
    hiddenSinceRef.current = document.visibilityState === "hidden" ? Date.now() : null;

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
      } else if (hiddenSinceRef.current !== null) {
        setHiddenSeconds((s) => s + (Date.now() - hiddenSinceRef.current!) / 1000);
        hiddenSinceRef.current = null;
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Count time hidden right up to when tracking stops (e.g. the job finished while backgrounded).
      if (hiddenSinceRef.current !== null) {
        setHiddenSeconds((s) => s + (Date.now() - hiddenSinceRef.current!) / 1000);
        hiddenSinceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return hiddenSeconds;
}

/**
 * Plain (non-hook) hidden-time tracker for use outside React — the browser backend's job
 * runner (web/src/backend/browser/runner.ts) isn't a component, but still wants to log how
 * long the tab was backgrounded during a job so a slow-connection download can be told apart
 * from background-tab throttling. Call the returned function when the job finishes; it stops
 * listening and returns the total seconds spent hidden since `startHiddenTracking()` was called.
 */
export function startHiddenTracking(): () => number {
  if (typeof document === "undefined") return () => 0;

  let hiddenMs = 0;
  let hiddenSince: number | null = document.visibilityState === "hidden" ? Date.now() : null;

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      hiddenSince = Date.now();
    } else if (hiddenSince !== null) {
      hiddenMs += Date.now() - hiddenSince;
      hiddenSince = null;
    }
  }

  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (hiddenSince !== null) {
      hiddenMs += Date.now() - hiddenSince;
      hiddenSince = null;
    }
    return hiddenMs / 1000;
  };
}

export interface StageTimings {
  downloadMs: number | null;
  transcribeMs: number | null;
  /** Duration of the audio that was transcribed, in seconds. */
  audioSeconds: number | null;
  hiddenSeconds: number;
}

/**
 * One-line console summary logged at the end of a job, e.g.:
 * "[recipe-transcriber] download 142s · transcribe 71s for 456s audio · tab hidden 0s"
 * so slow-connection downloads can be told apart from background-tab throttling later.
 * Segments with unknown timing (e.g. the model was already cached, so there was no
 * download stage) are omitted rather than shown as 0s/null.
 */
export function formatProcessingSummary({ downloadMs, transcribeMs, audioSeconds, hiddenSeconds }: StageTimings): string {
  const segments: string[] = [];
  if (downloadMs !== null) segments.push(`download ${Math.round(downloadMs / 1000)}s`);
  if (transcribeMs !== null) {
    const audioPart = audioSeconds !== null ? ` for ${Math.round(audioSeconds)}s audio` : "";
    segments.push(`transcribe ${Math.round(transcribeMs / 1000)}s${audioPart}`);
  }
  segments.push(`tab hidden ${Math.round(hiddenSeconds)}s`);
  return `[recipe-transcriber] ${segments.join(" · ")}`;
}
