import { SETTINGS_STORAGE_KEY } from "./constants";
import { DEFAULT_BROWSER_SETTINGS, type BrowserSettings } from "./types";

/**
 * Read/write helpers for browser-mode settings (`BrowserSettings`), stored as JSON in
 * localStorage under `SETTINGS_STORAGE_KEY`. Used by the Settings page and by the
 * Library's onboarding check (server mode never calls these). Wrapped in try/catch since
 * localStorage can throw (private browsing, disabled storage, etc).
 */
export function getBrowserSettings(): BrowserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_BROWSER_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_BROWSER_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_BROWSER_SETTINGS;
  }
}

export function saveBrowserSettings(settings: BrowserSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* localStorage unavailable; setting is lost for this session */
  }
}

export function hasApiKey(): boolean {
  return !!getBrowserSettings().apiKey;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
