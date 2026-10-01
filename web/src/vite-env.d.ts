/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "browser" selects the in-browser backend with the user's own API key (Whisper + IndexedDB +
   * BYOK Claude calls); "hosted" selects the same in-browser backend but with Claude calls routed
   * through the operator's Cloudflare Worker (no key in the browser, see backend/browser/proxyClaude.ts);
   * any other value (including unset) uses the server backend. */
  readonly VITE_BACKEND?: "browser" | "hosted" | "server";
  /** Hosted mode only: the Cloudflare Worker's base URL, e.g. "https://recipe-proxy.example.workers.dev"
   * (no trailing slash required). Public — baked into the hosted bundle. */
  readonly VITE_API_BASE?: string;
  /** Hosted mode only: the Cloudflare Turnstile site key. Site keys are public by design — safe to
   * embed in the bundle (see web/src/lib/turnstile.ts). */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
