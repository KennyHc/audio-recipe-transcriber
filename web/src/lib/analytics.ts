// Anonymous launch counts (contract: shared/stats.ts). Call `track(kind)` from anywhere; it
// never throws and never blocks. Nothing is sent until a sender is registered — only the
// cloud runtime does that (it needs the Cloud Run API), so every other build sends nothing.
// The sender dedupes per page session (sessionStorage) so a refresh doesn't double-count.
//
// What a beacon is: `POST /beacon {kind}` with the App Check header and nothing else — no ID
// token (even when signed in), no cookies, no ids, no URL. The API adds 1 to that day's total.
//
// Do Not Track / Global Privacy Control: when the browser sends either signal
// (navigator.doNotTrack === "1", window.doNotTrack === "1", or navigator.globalPrivacyControl
// === true), createBeaconSender() never sends anything — the visit simply isn't counted.

import type { BeaconKind } from "@recipe/shared";

/** `key` narrows the dedupe (recipe_view passes the recipe id); it is never sent. */
type Sender = (kind: BeaconKind, key?: string) => void;

let sender: Sender | null = null;
const pending: Array<[BeaconKind, string | undefined]> = [];

/** Called once by the cloud runtime; flushes anything tracked before it was ready. */
export function setAnalyticsSender(next: Sender | null): void {
  sender = next;
  if (sender) for (const [kind, key] of pending.splice(0)) safeSend(kind, key);
}

/** Counts one anonymous event. `key` (e.g. a recipe id) only scopes the once-per-session
 * dedupe — it never leaves the browser. */
export function track(kind: BeaconKind, key?: string): void {
  if (sender) safeSend(kind, key);
  else if (pending.length < 20) pending.push([kind, key]);
}

function safeSend(kind: BeaconKind, key: string | undefined): void {
  try {
    sender?.(kind, key);
  } catch {
    // Analytics must never break the app.
  }
}

// ---------------------------------------------------------------------------
// The cloud sender (privacy signals + per-session dedupe)
// ---------------------------------------------------------------------------

type PrivacyNavigator = { doNotTrack?: unknown; globalPrivacyControl?: unknown } | null | undefined;
type PrivacyWindow = { doNotTrack?: unknown } | null | undefined;

/** True when the browser asks not to be tracked (DNT) or sends Global Privacy Control. */
export function privacySignalOn(
  nav: PrivacyNavigator = typeof navigator === "undefined" ? null : (navigator as PrivacyNavigator),
  win: PrivacyWindow = typeof window === "undefined" ? null : (window as PrivacyWindow),
): boolean {
  try {
    if (nav?.globalPrivacyControl === true) return true;
    if (nav?.doNotTrack === "1" || nav?.doNotTrack === "yes") return true;
    if (win?.doNotTrack === "1") return true;
  } catch {
    /* unreadable → treat as no signal */
  }
  return false;
}

export const BEACON_STORAGE_PREFIX = "rt:beacon:";

export function beaconDedupeKey(kind: BeaconKind, key?: string): string {
  return key ? `${BEACON_STORAGE_PREFIX}${kind}:${key}` : `${BEACON_STORAGE_PREFIX}${kind}`;
}

type SessionStore = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): SessionStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null; // blocked storage throws on access
  }
}

export interface BeaconSenderDeps {
  /** Sends the beacon (the API client's POST /beacon). May reject; failures are swallowed. */
  post(kind: BeaconKind): Promise<unknown> | void;
  /** The page session's storage (sessionStorage); null when unavailable. */
  storage?: () => SessionStore | null;
  /** DNT / GPC check; defaults to privacySignalOn(). */
  privacySignal?: () => boolean;
}

/** At most one beacon per kind (per kind + key) per page session; nothing at all under DNT/GPC.
 * Never throws. */
export function createBeaconSender(deps: BeaconSenderDeps): Sender {
  const storage = deps.storage ?? defaultStorage;
  const privacySignal = deps.privacySignal ?? (() => privacySignalOn());
  const sentHere = new Set<string>(); // fallback when sessionStorage is unavailable

  return (kind, key) => {
    try {
      if (privacySignal()) return;
      const dedupe = beaconDedupeKey(kind, key);
      if (sentHere.has(dedupe)) return;
      sentHere.add(dedupe);
      let store: SessionStore | null = null;
      try {
        store = storage();
        if (store?.getItem(dedupe)) return;
        store?.setItem(dedupe, "1");
      } catch {
        /* storage blocked or full: the in-memory set still dedupes this page */
      }
      const result = deps.post(kind);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      /* never throw */
    }
  };
}
