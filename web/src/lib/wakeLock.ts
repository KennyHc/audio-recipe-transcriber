// Screen Wake Lock outside React, for the browser backend's job runner: phones dim and lock
// the screen after ~30 s, and a locked phone suspends the tab — which stops a long in-browser
// transcription. The runner holds the lock while a job transcribes (wherever the visitor is in
// the app, not only on the recipe page) and releases it when the job finishes or fails.
// The OS drops the lock whenever the tab is hidden; it is re-acquired when the tab is visible
// again. Feature-detected: does nothing (and never throws) where unsupported.
// (lib/processingHealth.ts's useWakeLock is the React-hook twin used by the recipe page.)

interface SentinelLike {
  release(): Promise<void>;
  addEventListener?(type: "release", listener: () => void): void;
}

export interface WakeLockEnv {
  navigator?: { wakeLock?: { request(type: "screen"): Promise<SentinelLike> } };
  document?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
}

function defaultEnv(): WakeLockEnv {
  return {
    navigator: typeof navigator !== "undefined" ? (navigator as WakeLockEnv["navigator"]) : undefined,
    document: typeof document !== "undefined" ? document : undefined,
  };
}

/**
 * Keeps the screen on until the returned function is called. Safe to call anywhere: with no
 * Wake Lock API (or no document) the returned release is a no-op.
 */
export function holdScreenWakeLock(env: WakeLockEnv = defaultEnv()): () => void {
  const wakeLock = env.navigator?.wakeLock;
  const doc = env.document;
  if (!wakeLock || typeof wakeLock.request !== "function" || !doc) return () => undefined;

  let sentinel: SentinelLike | null = null;
  let requesting = false;
  let released = false;

  async function acquire(): Promise<void> {
    if (released || sentinel || requesting || doc!.visibilityState !== "visible") return;
    requesting = true;
    try {
      const s = await wakeLock!.request("screen");
      if (released) {
        s.release().catch(() => undefined);
        return;
      }
      sentinel = s;
      // The OS releases it when the tab is hidden; forget it so the next "visible" re-acquires.
      s.addEventListener?.("release", () => {
        if (sentinel === s) sentinel = null;
      });
    } catch {
      // Rejected (tab hidden mid-request, battery saver, permissions policy) — try again later.
    } finally {
      requesting = false;
    }
  }

  const onVisibility = () => {
    if (doc.visibilityState === "visible") void acquire();
  };

  try {
    doc.addEventListener("visibilitychange", onVisibility);
  } catch {
    /* ignore */
  }
  void acquire();

  return () => {
    if (released) return;
    released = true;
    try {
      doc.removeEventListener("visibilitychange", onVisibility);
    } catch {
      /* ignore */
    }
    const s = sentinel;
    sentinel = null;
    s?.release().catch(() => undefined);
  };
}
