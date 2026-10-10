import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Search, X } from "lucide-react";
import { TAGS, type PublicRecipe } from "@recipe/shared";
import { publicBank } from "@/backend";
import { TAG_GROUPS, tagGroupOf, type ExploreTab, type TagGroup } from "@/lib/explore";
import { TAG_GROUP_LABELS, tagLabel } from "@/lib/publish";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PublicRecipeCard } from "@/components/public/PublicRecipeCard";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const SEARCH_DEBOUNCE_MS = 350;

const CHIP = "rounded-full border px-2.5 py-1 text-xs transition-colors";
const CHIP_ON = "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint-strong))] text-[hsl(var(--accent-text))]";
const CHIP_OFF = "border-[hsl(var(--border-strong))] text-[hsl(var(--ink-muted))] hover:bg-[hsl(var(--accent-tint))]";

/** "Cuisine ▾" — a compact button opening that group's tags. One active tag at a time. */
function TagFilter({ group, tag, onPick }: { group: TagGroup; tag: string | null; onPick: (tag: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const activeHere = tagGroupOf(tag) === group;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm transition-colors",
            activeHere
              ? "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]"
              : "border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] text-[hsl(var(--ink-muted))] hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]",
          )}
        >
          {TAG_GROUP_LABELS[group]}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent collisionPadding={16} className="w-[min(20rem,calc(100vw-2rem))] p-2.5" aria-label={`${TAG_GROUP_LABELS[group]} tags`}>
        <div className="flex flex-wrap gap-1.5">
          {TAGS[group].map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tag === t}
              onClick={() => {
                onPick(tag === t ? null : t);
                setOpen(false);
              }}
              className={cn(CHIP, tag === t ? CHIP_ON : CHIP_OFF)}
            >
              {tagLabel(t)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The public recipe bank (cloud mode; works signed out): Newest · Popular, search, tags. */
export function Explore() {
  const [tab, setTab] = useState<ExploreTab>("newest");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  const [items, setItems] = useState<PublicRecipe[] | null>(null);
  const [cursor, setCursor] = useState<unknown | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newestForSearch, setNewestForSearch] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!publicBank) return;
    const mine = ++seq.current;
    setItems(null);
    setCursor(null);
    setError(null);
    publicBank
      .explore({ tab, search, tag }, null)
      .then((page) => {
        if (mine !== seq.current) return;
        setItems(page.items);
        setCursor(page.cursor);
        setNewestForSearch(page.sortedByNewestForSearch);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        setItems([]);
        setError(err instanceof Error ? err.message : "Couldn't load recipes.");
      });
  }, [tab, search, tag]);

  async function loadMore() {
    if (!publicBank || !cursor) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const page = await publicBank.explore({ tab, search, tag }, cursor);
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

  const filtered = search.trim() !== "" || tag !== null;

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-6 sm:py-12 space-y-6">
      <div
        className="relative overflow-hidden rounded-[14px] px-5 py-6 sm:px-10 sm:py-10 space-y-4"
        style={{
          backgroundImage:
            "radial-gradient(70% 120% at 100% -10%, hsl(var(--accent-fill) / 0.14), transparent 70%), radial-gradient(45% 80% at 85% 0%, hsl(var(--accent-fill) / 0.1), transparent 75%), linear-gradient(180deg, hsl(var(--accent-tint) / 0.6), hsl(var(--background)))",
        }}
      >
        <div className="space-y-2">
          <h1 className="font-serif text-[34px] sm:text-[48px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
            Explore recipes
          </h1>
          <p className="max-w-[60ch] text-[hsl(var(--ink-muted))]">
            Recipes from cooking videos, written out step by step — with credit to the cooks who made them.
          </p>
        </div>

        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--ink-faint))]" />
          <input
            type="search"
            aria-label="Search recipes"
            placeholder="Search by title or ingredient"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-11 w-full rounded-[var(--radius-control)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] pl-9 pr-9 text-sm text-[hsl(var(--ink))] placeholder:text-[hsl(var(--ink-faint))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] [&::-webkit-search-cancel-button]:hidden"
          />
          {searchInput && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearchInput("");
                setSearch("");
              }}
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[hsl(var(--ink-faint))] hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Sort" className="inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] p-0.5">
            {(["newest", "popular"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-full px-3.5 py-1 text-sm transition-colors",
                  tab === t
                    ? "bg-[hsl(var(--surface))] font-medium text-[hsl(var(--ink))] shadow-[0_1px_2px_rgb(15_27_45_/_0.08)]"
                    : "text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))]",
                )}
              >
                {t === "newest" ? "Newest" : "Popular"}
              </button>
            ))}
          </div>
          {newestForSearch && tab === "popular" && (
            <span className="text-xs text-[hsl(var(--ink-faint))]">Search results are shown newest first.</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
          {TAG_GROUPS.map((g) => (
            <TagFilter key={g} group={g} tag={tag} onPick={setTag} />
          ))}
          {tag && (
            <button
              type="button"
              onClick={() => setTag(null)}
              aria-label={`Remove filter: ${tagLabel(tag)}`}
              className={cn(CHIP, CHIP_ON, "inline-flex h-8 items-center gap-1 pl-3 pr-2 text-sm")}
            >
              {tagLabel(tag)}
              <X className="h-3.5 w-3.5" />
            </button>
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
      ) : items.length === 0 && !cursor ? (
        <div className="rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] px-6 py-10 text-center space-y-1">
          <p className="text-sm font-medium text-[hsl(var(--ink-muted))]">
            {filtered ? "No recipes match" : "No public recipes yet"}
          </p>
          <p className="text-sm text-[hsl(var(--ink-faint))]">
            {filtered ? "Try another word or tag." : "Published recipes will show up here."}
          </p>
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
