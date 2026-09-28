// Theme preference: "light" | "dark" | "system", persisted to localStorage and
// applied via a `data-theme` attribute on <html>. "system" removes the
// attribute so the @media (prefers-color-scheme) rules in index.css take over.

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "recipe-transcriber:theme";

export function getStoredTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* localStorage unavailable (private mode, etc.) */
  }
  return "system";
}

export function applyTheme(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", pref);
  }
}

export function setStoredTheme(pref: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore write failures */
  }
  applyTheme(pref);
}
