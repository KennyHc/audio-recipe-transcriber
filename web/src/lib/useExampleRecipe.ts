import { useEffect, useState } from "react";
import { publicBank } from "@/backend";
import { publicHref } from "@/lib/router";

// "See an example": the most popular live public recipe (newest as a fallback), so visitors
// without a cooking clip can see a finished recipe in one click — and the example improves on
// its own as the bank grows. Cloud mode only (null elsewhere, or while loading / if empty).

let cached: Promise<string | null> | null = null;

async function loadExampleHref(): Promise<string | null> {
  if (!publicBank) return null;
  try {
    const popular = await publicBank.explore({ tab: "popular", search: "", tag: null }, null);
    const first = popular.items[0] ?? (await publicBank.recentPublic(1))[0];
    return first ? publicHref(first.id) : null;
  } catch {
    return null;
  }
}

export function useExampleRecipeHref(): string | null {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    cached ??= loadExampleHref();
    void cached.then((h) => {
      if (alive) setHref(h);
    });
    return () => {
      alive = false;
    };
  }, []);
  return href;
}
