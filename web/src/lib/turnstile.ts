// Thin wrapper around Cloudflare Turnstile (https://developers.cloudflare.com/turnstile/) for
// the hosted build: every request to the Worker (see shared/proxy.ts) must carry a fresh,
// single-use token in the X-Turnstile-Token header. This module lazy-loads the Turnstile
// script once (explicit render — we control exactly when the widget appears and executes),
// renders a single invisible/managed widget in a fixed off-screen container, and exposes
// getTurnstileToken() to fetch one fresh token immediately before each proxy request. The
// widget is reset before every execution since Turnstile tokens are single-use.
//
// Local/dev testing: Cloudflare's published "always passes" test site key
// 1x00000000000000000000AA (see web/.env.hosted.example) works against any hostname, with no
// Cloudflare account needed.

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const CONTAINER_ID = "turnstile-container";
const TOKEN_TIMEOUT_MS = 15_000;

interface TurnstileRenderOptions {
  sitekey: string;
  size?: "invisible" | "normal" | "compact";
  execution?: "render" | "execute";
  callback?: (token: string) => void;
  "error-callback"?: (code?: string) => void;
  "expired-callback"?: () => void;
}

interface TurnstileApi {
  render(container: string | HTMLElement, options: TurnstileRenderOptions): string;
  execute(container: string | HTMLElement, options?: { action?: string }): void;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoadPromise: Promise<TurnstileApi> | null = null;
let widgetId: string | null = null;

// Exactly one getTurnstileToken() call is ever "in flight" against the shared widget at a
// time in normal operation (extract/verify run sequentially — see runner.ts's single-flight
// job queue); this holds that call's resolver so the widget's render-time callbacks (which
// Turnstile invokes once per execute(), not once per render()) can settle it.
let pending: { resolve: (token: string) => void; reject: (err: Error) => void } | null = null;
let pendingResolve: ((token: string) => void) | null = null;
let pendingReject: ((err: Error) => void) | null = null;

function clearPending(): void {
  pending = null;
  pendingResolve = null;
  pendingReject = null;
}

function onSuccess(token: string): void {
  const resolve = pendingResolve;
  clearPending();
  resolve?.(token);
}

function onError(): void {
  const reject = pendingReject;
  clearPending();
  reject?.(new Error("Couldn't verify this browser — please reload the page and try again."));
}

function onExpired(): void {
  onError();
}

function loadScript(): Promise<TurnstileApi> {
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Turnstile requires a browser environment."));
      return;
    }
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile script loaded but window.turnstile is missing."));
    };
    script.onerror = () => reject(new Error("Could not load the Turnstile verification script — check your connection."));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

function ensureContainer(): HTMLElement {
  let el = document.getElementById(CONTAINER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = CONTAINER_ID;
    // Off-screen rather than display:none — some challenge platforms treat a display:none
    // widget as suspicious; this keeps it technically visible but inert and unnoticeable.
    Object.assign(el.style, {
      position: "fixed",
      bottom: "0",
      left: "0",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      opacity: "0",
      pointerEvents: "none",
    });
    document.body.appendChild(el);
  }
  return el;
}

async function ensureWidget(): Promise<{ turnstile: TurnstileApi; id: string }> {
  const turnstile = await loadScript();
  if (widgetId !== null) return { turnstile, id: widgetId };

  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (!sitekey) {
    throw new Error("VITE_TURNSTILE_SITE_KEY is not configured for this hosted build.");
  }

  widgetId = turnstile.render(ensureContainer(), {
    sitekey,
    size: "invisible",
    execution: "execute",
    callback: onSuccess,
    "error-callback": onError,
    "expired-callback": onExpired,
  });
  return { turnstile, id: widgetId };
}

/**
 * Resolves with a fresh, single-use Turnstile token for the next proxy request. Rejects after
 * ~15s if the widget doesn't respond in time (e.g. challenges.cloudflare.com is blocked on this
 * network, or the script failed to load) with a clear, user-facing message.
 */
export function getTurnstileToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearPending();
      reject(new Error("Timed out verifying this browser — please reload the page and try again."));
    }, TOKEN_TIMEOUT_MS);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    pending = { resolve: (t) => settle(() => resolve(t)), reject: (e) => settle(() => reject(e)) };
    pendingResolve = pending.resolve;
    pendingReject = pending.reject;

    ensureWidget()
      .then(({ turnstile, id }) => {
        turnstile.reset(id); // tokens are single-use; always execute from a clean state
        turnstile.execute(ensureContainer());
      })
      .catch((err: unknown) => {
        clearPending();
        settle(() => reject(err instanceof Error ? err : new Error(String(err))));
      });
  });
}

/** Test-only: resets this module's singleton widget/script state between tests. */
export function _resetTurnstileForTests(): void {
  scriptLoadPromise = null;
  widgetId = null;
  clearPending();
}
