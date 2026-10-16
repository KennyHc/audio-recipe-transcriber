// Must stay the first import: starts the current page's chunk download before the App import
// waits for the runtime (see routePreload.ts).
import "./routePreload";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyTheme, getStoredTheme } from "./lib/theme";
import { installGlobalErrorHandlers } from "./lib/errorReporting";
import { track } from "./lib/analytics";

// Privacy-safe crash reports (cloud build only — a no-op elsewhere; see lib/errorReporting.ts).
installGlobalErrorHandlers();

// One anonymous "visit" count per page session (cloud build only; skipped under DNT/GPC — see
// lib/analytics.ts).
track("visit");

// Apply the stored theme before first paint to avoid a flash of the wrong theme.
applyTheme(getStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
