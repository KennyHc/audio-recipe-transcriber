// Pure decision logic for the model-download consent dialog (see
// web/src/components/ModelDownloadDialog.tsx). Kept free of DOM/localStorage/network access
// so the "should we ask?" rule is unit-testable without mocking a browser.

/**
 * Whether the consent dialog should be shown before starting a transcription job.
 *
 * We only ever ask once per model: if the chosen speech model+dtype is already fully
 * downloaded (per modelCatalog's isModelCached), there is nothing to consent to — later
 * clips start immediately, silently, exactly as before this feature existed.
 */
export function shouldShowModelConsentDialog({ isCached }: { isCached: boolean }): boolean {
  return !isCached;
}

/** The minimal shape of `navigator.connection` (the Network Information API) we read.
 * Not all browsers implement it (notably Safari) — callers pass `null` when absent. */
export interface NetworkConnectionInfo {
  saveData?: boolean;
  effectiveType?: string;
}

const SLOW_EFFECTIVE_TYPES = new Set(["slow-2g", "2g", "3g"]);

/** Whether to show a "Wi-Fi recommended" note: true if the user has Data Saver on, or the
 * browser reports an effective connection speed of 2G/3G or slower. `null`/`undefined`
 * (API unsupported, or info not yet available) means "don't know" — we don't warn on absence
 * of information, only on positive evidence of a slow/metered connection. */
export function shouldRecommendWifi(connection: NetworkConnectionInfo | null | undefined): boolean {
  if (!connection) return false;
  if (connection.saveData) return true;
  if (connection.effectiveType && SLOW_EFFECTIVE_TYPES.has(connection.effectiveType)) return true;
  return false;
}

/** Thin, untested-by-design wrapper around the real navigator.connection (Network
 * Information API is Chromium-only as of writing; absent elsewhere). Callers should prefer
 * passing the object straight to shouldRecommendWifi for testability. */
export function readNetworkConnectionInfo(): NetworkConnectionInfo | null {
  try {
    const nav = navigator as Navigator & { connection?: NetworkConnectionInfo };
    return nav.connection ?? null;
  } catch {
    return null;
  }
}

/**
 * State machine for what the job page should show while a job's speech model may not be
 * downloaded yet. `pending` is the state right after upload, before we've checked the
 * cache; a caller resolves it to `ready` (cached, or user pressed Download and it
 * completed) or `waiting-for-consent` (not cached, dialog needs to be shown/re-shown —
 * this is also the state after the user presses Cancel, so the job stays paused instead of
 * erroring).
 */
export type ModelReadinessState = "pending" | "ready" | "waiting-for-consent";

export function decideModelReadiness({
  isCached,
  consentedThisSession,
}: {
  isCached: boolean;
  /** True once the user has pressed "Download" for this model in this session (or ever,
   * if the caller chooses to persist that — this module doesn't prescribe storage). */
  consentedThisSession: boolean;
}): ModelReadinessState {
  if (isCached || consentedThisSession) return "ready";
  return "waiting-for-consent";
}
