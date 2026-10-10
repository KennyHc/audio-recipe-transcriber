import type { Backend } from "./types";
import { createServerBackend } from "./server";
import type { Account } from "./account";
import type { PublicBank } from "./publicBank";

// The build-time mode switch. Vite inlines `import.meta.env.VITE_BACKEND` as a string
// literal at build time, so `npm run build` (VITE_BACKEND unset → "server" branch) never
// even sees the dynamic import of "./browser" as reachable code — esbuild's dead-code
// elimination on the `if (false)` drops it before Rollup would otherwise pull
// transformers.js and the rest of the browser backend into the server bundle.
//
// We resolve `backend` with a top-level await (rather than an async getter) so every
// call site stays a plain `backend.listJobs()` etc. instead of `(await getBackend()).x()`.
// The cost is that module evaluation — and therefore first paint — waits for the dynamic
// import to resolve in browser mode; that's a one-time, same-tick cost since the import
// itself is local code (no network round trip beyond the browser backend's own chunk).
async function resolveRuntime(): Promise<{ backend: Backend; account: Account | null; publicBank: PublicBank | null }> {
  // "cloud" (signed-in SaaS) — Firebase is only ever reachable through this branch, so the
  // other builds don't contain it (same dead-code elimination as below).
  if (import.meta.env.VITE_BACKEND === "cloud") {
    const { createCloudRuntime } = await import("./cloud");
    return createCloudRuntime();
  }
  // "hosted" shares the same in-browser backend as "browser" (IndexedDB storage, in-page
  // Whisper pipeline) — only its Claude calls differ, swapped inside browser/claudeProvider.ts.
  if (import.meta.env.VITE_BACKEND === "browser" || import.meta.env.VITE_BACKEND === "hosted") {
    const { createBrowserBackend } = await import("./browser");
    return { backend: createBrowserBackend(), account: null, publicBank: null };
  }
  return { backend: createServerBackend(), account: null, publicBank: null };
}

const runtime = await resolveRuntime();

export const backend: Backend = runtime.backend;
/** The signed-in account in cloud mode; null in every other mode (no accounts there). */
export const account: Account | null = runtime.account;
/** The public recipe bank in cloud mode (works signed out); null in every other mode. */
export const publicBank: PublicBank | null = runtime.publicBank;

export * from "./types";
export type { Account, AccountUser } from "./account";
export type { PublicBank, ExplorePage, SavedEntry } from "./publicBank";
