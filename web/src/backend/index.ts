import type { Backend } from "./types";
import { createServerBackend } from "./server";

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
async function resolveBackend(): Promise<Backend> {
  if (import.meta.env.VITE_BACKEND === "browser") {
    const { createBrowserBackend } = await import("./browser");
    return createBrowserBackend();
  }
  return createServerBackend();
}

export const backend: Backend = await resolveBackend();

export * from "./types";
