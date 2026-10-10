import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Compass, Loader2 } from "lucide-react";
import type { PublicRecipe } from "@recipe/shared";
import { publicBank } from "@/backend";
import { creatorStatsLine, normalizeHandleParam, sumCreatorStats, type CreatorTotals } from "@/lib/creator";
import { exploreHref } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { PublicRecipeCard } from "@/components/public/PublicRecipeCard";

/** /@handle — a creator's live public recipes, newest first (cloud mode; works signed out). */
export function CreatorPage({ handle: rawHandle }: { handle: string }) {
  const handle = normalizeHandleParam(rawHandle);
  const shown = handle ?? rawHandle.replace(/^@/, "");

  const [items, setItems] = useState<PublicRecipe[] | null>(null);
  const [cursor, setCursor] = useState<unknown | null>(null);
  const [totals, setTotals] = useState<CreatorTotals | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const previous = document.title;
    document.title = `@${shown} · Recipe Transcriber`;
    return () => {
      document.title = previous;
    };
  }, [shown]);

  useEffect(() => {
    const mine = ++seq.current;
    setItems(null);
    setCursor(null);
    setTotals(null);
    setError(null);
    if (!publicBank || !handle) {
      setItems([]);
      return;
    }
    publicBank
      .listByCreator(handle, null)
      .then((page) => {
        if (mine !== seq.current) return;
        setItems(page.items);
        setCursor(page.cursor);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        setItems([]);
        setError(err instanceof Error ? err.message : "Couldn't load recipes.");
      });
    publicBank
      .creatorTotals(handle)
      .then((t) => {
        if (mine === seq.current) setTotals(t);
      })
      .catch(() => undefined);
  }, [handle]);

  async function loadMore() {
    if (!publicBank || !handle || !cursor) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const page = await publicBank.listByCreator(handle, cursor);
      if (mine !== seq.current) return;
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((p) => p.id));
        return [...(prev ?? []), ...page.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load more recipes.");
    } finally {
      setLoadingMore(false);
    }
  }

  // Server-side totals when available; otherwise what's loaded ("24+ recipes" if there's more).
  const statsLine =
    items && items.length > 0
      ? totals && totals.recipes > 0
        ? creatorStatsLine(totals)
        : creatorStatsLine(sumCreatorStats(items), cursor !== null)
      : null;

  return (
    <div className="mx-auto max-w-[1120px] space-y-6 px-4 pb-16 pt-6 sm:space-y-8">
      <a
        href={exploreHref()}
        className="no-print inline-flex items-center gap-1 text-sm text-[hsl(var(--ink-muted))] transition-colors hover:text-[hsl(var(--ink))]"
      >
        <ArrowLeft className="h-4 w-4" /> Explore recipes
      </a>

      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent-tint-strong))] font-serif text-[28px] leading-none text-[hsl(var(--accent-text))] sm:h-16 sm:w-16 sm:text-[32px]"
        >
          {(shown[0] ?? "?").toUpperCase()}
        </span>
        <div className="min-w-0 space-y-1">
          <h1 className="truncate font-serif text-[34px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))] sm:text-[44px]">
            @{shown}
          </h1>
          {(statsLine || items === null) && (
            <p className="text-sm tabular-nums text-[hsl(var(--ink-muted))]">{statsLine ?? " "}</p>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[hsl(var(--danger))]">
          {error}
        </p>
      )}

      {items === null ? (
        <p className="text-sm text-[hsl(var(--ink-muted))]">Loading…</p>
      ) : items.length === 0 && !error ? (
        <div className="space-y-3 rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] px-6 py-10 text-center">
          <div className="space-y-1">
            <p className="text-sm font-medium text-[hsl(var(--ink-muted))]">No recipes from @{shown} yet</p>
            <p className="text-sm text-[hsl(var(--ink-faint))]">
              {handle ? "When they share a recipe in the bank, it'll show up here." : "This link doesn't look quite right."}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={exploreHref()}>
              <Compass className="h-4 w-4" /> Explore recipes
            </a>
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((pub) => (
            <li key={pub.id}>
              <PublicRecipeCard pub={pub} />
            </li>
          ))}
        </ul>
      )}

      {cursor !== null && items !== null && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
