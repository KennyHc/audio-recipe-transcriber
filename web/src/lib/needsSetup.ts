import { NeedsSetupError } from "@/backend/types";
import { navigate, settingsHref } from "@/lib/router";

const MESSAGE_KEY = "recipe-transcriber:setup-message";

/**
 * Call from a catch block around any `backend.*` call. If `err` is a `NeedsSetupError`
 * (browser mode, missing API key), routes to Settings with a short explanatory message
 * and returns true so the caller can skip setting its own error state. Otherwise returns
 * false and does nothing, so the caller falls back to its normal error handling.
 */
export function routeIfNeedsSetup(err: unknown): boolean {
  if (!(err instanceof NeedsSetupError)) return false;
  try {
    sessionStorage.setItem(MESSAGE_KEY, err.message || "Add your Anthropic API key to continue.");
  } catch {
    /* ignore */
  }
  navigate(settingsHref());
  return true;
}

/** Read (and clear) the message left by `routeIfNeedsSetup`, for the Settings page to show once. */
export function consumeSetupMessage(): string | null {
  try {
    const msg = sessionStorage.getItem(MESSAGE_KEY);
    if (msg) sessionStorage.removeItem(MESSAGE_KEY);
    return msg;
  } catch {
    return null;
  }
}
