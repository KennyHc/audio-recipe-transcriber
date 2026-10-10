import { useEffect, useState } from "react";

// Routes are hash routes (#/jobs/:id, #/settings, …) — except two PATH routes: the public recipe
// page /r/{id} and the creator page /@handle. Link-preview crawlers ignore everything after "#", so shared links must be real
// paths (Cloudflare Pages serves index.html for them; web/functions/r/[id].ts adds the meta tags).
//
// Moving between the two kinds of URL stays inside the app: navigate() and a document-level
// click handler use history.pushState for "/r/…" and "/@…" links, and for "#/…" links while the page is on
// a path route (otherwise the browser would append the hash to /r/{id}), then announce the change
// with ROUTE_CHANGE_EVENT. Back/forward fire popstate (path changes) or hashchange (hash changes).

export type Route =
  | { name: "library" }
  | { name: "job"; id: string; cook: boolean }
  | { name: "settings" }
  | { name: "privacy" }
  | { name: "terms" }
  | { name: "explore" }
  | { name: "admin" }
  | { name: "list" }
  | { name: "public"; id: string }
  | { name: "creator"; handle: string };

export const ROUTE_CHANGE_EVENT = "rt:routechange";

const PUBLIC_PATH = /^\/r\/([^/]+)\/?$/;
/** Creator pages: /@handle (also /%40handle, as some apps encode the "@"). */
const CREATOR_PATH = /^\/(?:@|%40)([^/]+)\/?$/i;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts[0] === "jobs" && parts[1]) {
    return { name: "job", id: decodeURIComponent(parts[1]), cook: parts[2] === "cook" };
  }
  switch (parts[0]) {
    case "settings":
      return { name: "settings" };
    case "privacy":
      return { name: "privacy" };
    case "terms":
      return { name: "terms" };
    case "explore":
      return { name: "explore" };
    case "admin":
      return { name: "admin" };
    case "list":
      return { name: "list" };
    default:
      return { name: "library" };
  }
}

/** The path routes win: /r/{id} and /@handle are what they say whatever the hash says. */
export function parseLocation(pathname: string, hash: string): Route {
  const m = PUBLIC_PATH.exec(pathname);
  if (m) return { name: "public", id: safeDecode(m[1]) };
  const c = CREATOR_PATH.exec(pathname);
  if (c) return { name: "creator", handle: safeDecode(c[1]) };
  return parseHash(hash);
}

export function isPathRoute(pathname: string): boolean {
  return PUBLIC_PATH.test(pathname) || CREATOR_PATH.test(pathname);
}

function currentRoute(): Route {
  return parseLocation(window.location.pathname, window.location.hash);
}

/**
 * Decides how an in-app link should navigate. "push" = history.pushState(url) + route event;
 * "default" = let the browser handle it (a plain hash change on "/", or a foreign link).
 */
export function linkNavigation(href: string, pathname: string): { kind: "push"; url: string } | { kind: "default" } {
  if (href.startsWith("/r/") || href.startsWith("/@")) return { kind: "push", url: href };
  if (href.startsWith("#") && isPathRoute(pathname)) return { kind: "push", url: `/${href === "#" ? "#/" : href}` };
  return { kind: "default" };
}

function announce() {
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

export function navigate(path: string) {
  const nav = linkNavigation(path, window.location.pathname);
  if (nav.kind === "push") {
    window.history.pushState(null, "", nav.url);
    window.scrollTo(0, 0);
    announce();
    return;
  }
  window.location.hash = path;
}

let clickHandlerInstalled = false;

/** Keeps in-app <a href="/r/…"> and <a href="#/…"> (on a path route) inside the SPA. */
function installLinkHandler() {
  if (clickHandlerInstalled) return;
  clickHandlerInstalled = true;
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = (event.target as Element | null)?.closest?.("a");
    if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    const nav = linkNavigation(href, window.location.pathname);
    if (nav.kind !== "push") return;
    event.preventDefault();
    window.history.pushState(null, "", nav.url);
    window.scrollTo(0, 0);
    announce();
  });
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    installLinkHandler();
    const update = () => setRoute(currentRoute());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    window.addEventListener(ROUTE_CHANGE_EVENT, update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
      window.removeEventListener(ROUTE_CHANGE_EVENT, update);
    };
  }, []);

  return route;
}

export function jobHref(id: string) {
  return `#/jobs/${encodeURIComponent(id)}`;
}

export function cookHref(id: string) {
  return `#/jobs/${encodeURIComponent(id)}/cook`;
}

export function settingsHref() {
  return "#/settings";
}

export function privacyHref() {
  return "#/privacy";
}

export function termsHref() {
  return "#/terms";
}

export function exploreHref() {
  return "#/explore";
}

export function shoppingListHref() {
  return "#/list";
}

export function adminHref() {
  return "#/admin";
}

/** The shareable public page — a real path (see the top of this file). */
export function publicHref(id: string) {
  return `/r/${encodeURIComponent(id)}`;
}

/** A creator's page — a real path like /r/{id}. */
export function creatorHref(handle: string) {
  return `/@${encodeURIComponent(handle)}`;
}

export function publicUrl(id: string, origin: string = window.location.origin) {
  return `${origin}${publicHref(id)}`;
}
