// Browser-mode settings persisted in localStorage. Every access is wrapped in
// try/catch: localStorage can throw (private browsing, disabled storage, quota),
// and we never want a settings read/write to take down the app.
//
// The Settings page (owned by the UI) reads/writes the same localStorage key
// directly as JSON of BrowserSettings, so this module also listens for the
// `storage` event (fired in OTHER tabs/windows) and exposes `reload()` so
// callers in THIS tab (e.g. the job runner, before starting a job) can pick up
// changes the Settings page just made in the same tab, where `storage` does
// not fire.

import { DEFAULT_BROWSER_SETTINGS, type BrowserSettings } from "../types";
import { SETTINGS_STORAGE_KEY } from "../constants";
import { readDeviceFacts, recommendSpeechModel } from "@/lib/deviceProfile";
import { SPEECH_MODEL_CATALOG } from "./modelCatalog";

type Listener = (settings: BrowserSettings) => void;

const listeners = new Set<Listener>();
let cached: BrowserSettings = readFromStorage();

/** The defaults, with the speech model pre-selected for this device (lib/deviceProfile.ts). */
function deviceDefaults(): BrowserSettings {
  const base = { ...DEFAULT_BROWSER_SETTINGS };
  try {
    if (recommendSpeechModel(readDeviceFacts()).size === "small") {
      const small = SPEECH_MODEL_CATALOG.find((o) => o.repoId === "onnx-community/whisper-small");
      if (small) return { ...base, whisperModel: small.repoId, whisperDtype: small.dtype };
    }
  } catch {
    // Device detection is best-effort; fall back to the static defaults.
  }
  return base;
}

function readFromStorage(): BrowserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return deviceDefaults();
    // A saved choice (from Settings or the download dialog) always wins over the device default.
    const parsed = JSON.parse(raw) as Partial<BrowserSettings>;
    return { ...deviceDefaults(), ...parsed };
  } catch {
    return deviceDefaults();
  }
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener(cached);
    } catch {
      // A listener throwing must not break the others.
    }
  }
}

/** Re-reads localStorage into the in-memory cache (e.g. after another part of
 * this tab wrote it directly) and notifies subscribers if it changed. */
export function reloadSettings(): BrowserSettings {
  const next = readFromStorage();
  const changed = JSON.stringify(next) !== JSON.stringify(cached);
  cached = next;
  if (changed) notify();
  return cached;
}

export function getSettings(): BrowserSettings {
  return cached;
}

export function saveSettings(settings: BrowserSettings): void {
  cached = settings;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort: keep the in-memory cache even if persistence failed.
  }
  notify();
}

export function updateSettings(patch: Partial<BrowserSettings>): BrowserSettings {
  const next = { ...cached, ...patch };
  saveSettings(next);
  return next;
}

/** Subscribe to settings changes (from this tab or, via the `storage` event,
 * others). Returns an unsubscribe function. */
export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

try {
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== SETTINGS_STORAGE_KEY) return;
      reloadSettings();
    });
  }
} catch {
  // No window (e.g. running in a non-browser test environment without jsdom) — fine,
  // callers can still use getSettings/saveSettings/reloadSettings directly.
}
