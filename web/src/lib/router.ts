import { useEffect, useState } from "react";

export type Route = { name: "library" } | { name: "job"; id: string; cook: boolean };

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts[0] === "jobs" && parts[1]) {
    return { name: "job", id: decodeURIComponent(parts[1]), cook: parts[2] === "cook" };
  }
  return { name: "library" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}

export function jobHref(id: string) {
  return `#/jobs/${encodeURIComponent(id)}`;
}

export function cookHref(id: string) {
  return `#/jobs/${encodeURIComponent(id)}/cook`;
}
