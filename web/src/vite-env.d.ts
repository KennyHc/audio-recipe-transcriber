/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "browser" selects the in-browser backend with the user's own API key (Whisper + IndexedDB +
   * BYOK Claude calls); "hosted" selects the same in-browser backend but with Claude calls routed
   * through the operator's Cloudflare Worker (no key in the browser, see backend/browser/proxyClaude.ts);
   * "cloud" selects the signed-in SaaS mode (Firebase Auth + Firestore + the Cloud Run API in api/;
   * transcription still runs in the browser, see backend/cloud/); any other value (including unset)
   * uses the server backend. */
  readonly VITE_BACKEND?: "browser" | "hosted" | "cloud" | "server";
  /** Hosted mode: the Cloudflare Worker's base URL, e.g. "https://recipe-proxy.example.workers.dev".
   * Cloud mode: the Cloud Run API's base URL (locally http://localhost:8080). No trailing slash
   * required. Public — baked into the bundle. */
  readonly VITE_API_BASE?: string;
  /** Hosted mode only: the Cloudflare Turnstile site key. Site keys are public by design — safe to
   * embed in the bundle (see web/src/lib/turnstile.ts). */
  readonly VITE_TURNSTILE_SITE_KEY?: string;

  // Cloud mode only — the Firebase web config. Public by design (it identifies the project; access
  // is enforced by Auth, App Check and firebase/firestore.rules). See web/.env.cloud.example.
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  /** reCAPTCHA Enterprise site key registered with Firebase App Check. */
  readonly VITE_APPCHECK_SITE_KEY?: string;
  /** "true" = talk to the local Firebase emulators (Auth :9099, Firestore :8085) and use an App
   * Check debug token. */
  readonly VITE_USE_EMULATORS?: string;
  /** Emulator mode only: the emulators' project id (default "demo-recipe", as in firebase/package.json). */
  readonly VITE_EMULATOR_PROJECT_ID?: string;
  /** Emulator mode only: Firestore emulator port (default 8085, see firebase/firebase.json). */
  readonly VITE_FIRESTORE_EMULATOR_PORT?: string;
  /** Emulator mode only: Auth emulator port (default 9099). */
  readonly VITE_AUTH_EMULATOR_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
