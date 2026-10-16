// Side-effect module, imported FIRST by main.tsx: starts downloading the current page's chunk
// (pages/lazyPages.ts) before the App import, which waits for the runtime (Firebase in the
// cloud build) to load. ES imports are hoisted, so this has to be its own module to run early.
//
// In the cloud build the home route ("library") is skipped: signed-out visitors see the landing
// there, so its chunk would be wasted on exactly the people a shared link brings in.

import { preloadRoute } from "./pages/lazyPages";
import { parseLocation } from "./lib/router";
import { IS_CLOUD } from "./lib/mode";

try {
  const name = parseLocation(window.location.pathname, window.location.hash).name;
  if (!(IS_CLOUD && name === "library")) preloadRoute(name);
} catch {
  /* best effort */
}
