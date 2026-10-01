/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "browser" selects the in-browser backend (Whisper + IndexedDB + user API key); any other value (including unset) uses the server backend. */
  readonly VITE_BACKEND?: "browser" | "server";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
