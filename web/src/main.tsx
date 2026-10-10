import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyTheme, getStoredTheme } from "./lib/theme";
import { installGlobalErrorHandlers } from "./lib/errorReporting";

// Privacy-safe crash reports (cloud build only — a no-op elsewhere; see lib/errorReporting.ts).
installGlobalErrorHandlers();

// Apply the stored theme before first paint to avoid a flash of the wrong theme.
applyTheme(getStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
