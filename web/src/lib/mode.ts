// Build-time mode flags, resolved from the statically-known VITE_BACKEND env var (see
// vite-env.d.ts and backend/index.ts). Kept separate from `backend.kind` (which stays
// "browser" for both BYOK and hosted — they share the same IndexedDB/Whisper core, see
// backend/browser/index.ts) because a handful of UI spots (Settings, Library, the header
// hint) need to tell the two apart without the Backend interface knowing about billing/auth.

/** True in a build made with `VITE_BACKEND=hosted` — Claude is called through the operator's
 * Cloudflare Worker (shared/proxy.ts) instead of the visitor's own API key. */
export const IS_HOSTED = import.meta.env.VITE_BACKEND === "hosted";
