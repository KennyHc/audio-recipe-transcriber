import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, Check, ChevronDown, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { TAGS, type PublicRecipe } from "@recipe/shared";
import { publicBank } from "@/backend";
import {
  TAG_GROUPS,
  exploreEmptyMessage,
  tagFilterButtonLabel,
  type ExploreTab,
  type TagGroup,
} from "@/lib/explore";
import { TAG_GROUP_LABELS, tagLabel } from "@/lib/publish";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PublicRecipeCard } from "@/components/public/PublicRecipeCard";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const SEARCH_DEBOUNCE_MS = 350;

/** The app header's height (App.tsx: 36px row + 2 × 10px padding + 1px border) — the toolbar sticks under it. */
const HEADER_OFFSET = "top-[57px]";

const CHIP = "rounded-full border px-2.5 py-1 text-xs transition-colors";
const CHIP_ON = "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint-strong))] text-[hsl(var(--accent-text))]";
const CHIP_OFF = "border-[hsl(var(--border-strong))] text-[hsl(var(--ink-muted))] hover:bg-[hsl(var(--accent-tint))]";

/** Every toolbar control shares this height so the row reads as one line. */
const CONTROL_H = "h-10";
const PILL = cn(
  "inline-flex shrink-0 items-center gap-1 rounded-full border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
  CONTROL_H,
);
const PILL_OFF =
  "border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] text-[hsl(var(--ink-muted))] hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]";
const PILL_ON = "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]";

const SORT_LABELS: Record<ExploreTab, string> = { newest: "Newest", popular: "Popular" };

/** "Cuisine ▾" — a compact button opening that group's tags. One active tag at a time; when the
 * tag is in this group the button shows it ("Chinese") with an × to clear it. */
function TagFilter({ group, tag, onPick }: { group: TagGroup; tag: string | null; onPick: (tag: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const label = tagFilterButtonLabel(group, tag, { group: (g) => TAG_GROUP_LABELS[g], tag: tagLabel });
  return (
    <div className={cn(PILL, label.active ? PILL_ON : PILL_OFF, "hidden gap-0 sm:inline-flex")}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label.active ? `${TAG_GROUP_LABELS[group]}: ${label.text}` : undefined}
            className={cn(
              "inline-flex h-full items-center gap-1 rounded-full pl-3 focus-visible:outline-none",
              label.active ? "pr-1" : "pr-2.5",
            )}
          >
            <span className="max-w-[9rem] truncate">{label.text}</span>
            {!label.active && <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-180")} />}
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
      {label.active && (
        <button
          type="button"
          onClick={() => onPick(null)}
          aria-label={`Remove filter: ${label.text}`}
          className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[hsl(var(--accent-tint-strong))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Phones: Cuisine / Meal / Diet in one "Filter" menu (so the controls fit one row), with the
 * picked tag as a removable chip beside it. */
function MobileTagFilter({ tag, onPick }: { tag: string | null; onPick: (tag: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn(PILL, PILL_OFF, "px-3 sm:hidden")}>
            <SlidersHorizontal className="h-3.5 w-3.5 text-[hsl(var(--ink-faint))]" />
            Filter
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-180")} />
          </button>
        </PopoverTrigger>
        <PopoverContent collisionPadding={16} className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-3" aria-label="Filter by tag">
          {TAG_GROUPS.map((g) => (
            <div key={g} className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">{TAG_GROUP_LABELS[g]}</p>
              <div className="flex flex-wrap gap-1.5">
                {TAGS[g].map((t) => (
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
            </div>
          ))}
        </PopoverContent>
      </Popover>
      {tag && (
        <button
          type="button"
          onClick={() => onPick(null)}
          aria-label={`Remove filter: ${tagLabel(tag)}`}
          className={cn(PILL, PILL_ON, "min-w-0 pl-3 pr-2 sm:hidden")}
        >
          <span className="truncate">{tagLabel(tag)}</span>
          <X className="h-3.5 w-3.5 shrink-0" />
        </button>
      )}
    </>
  );
}

/** Newest · Popular as a segmented control (≥640px). */
function SortTabs({ tab, onChange }: { tab: ExploreTab; onChange: (t: ExploreTab) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Sort"
      className={cn("hidden shrink-0 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] p-1 sm:inline-flex", CONTROL_H)}
    >
      {(["newest", "popular"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={tab === t}
          onClick={() => onChange(t)}
          className={cn(
            "rounded-full px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
            tab === t
              ? "bg-[hsl(var(--surface))] font-medium text-[hsl(var(--ink))] shadow-[0_1px_2px_rgb(15_27_45_/_0.08)]"
              : "text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))]",
          )}
        >
          {SORT_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

/** The same choice as a compact menu on phones, so the controls fit one row under the search. */
function SortMenu({ tab, onChange }: { tab: ExploreTab; onChange: (t: ExploreTab) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Sort: ${SORT_LABELS[tab]}`} className={cn(PILL, PILL_OFF, "px-3 text-[hsl(var(--ink))] sm:hidden")}>
          <ArrowDownUp className="h-3.5 w-3.5 text-[hsl(var(--ink-faint))]" />
          {SORT_LABELS[tab]}
        </button>
      </PopoverTrigger>
      <PopoverContent collisionPadding={16} className="w-44 p-1" aria-label="Sort">
        {(["newest", "popular"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => {
              onChange(t);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between rounded-[6px] px-2.5 py-2 text-left text-sm hover:bg-[hsl(var(--accent-tint))]"
          >
            {SORT_LABELS[t]}
            {tab === t && <Check className="h-4 w-4 text-[hsl(var(--accent-text))]" />}
          </button>
        ))}
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

  // A hairline under the toolbar only once it's stuck under the header.
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { rootMargin: "-58px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

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

  const empty = exploreEmptyMessage({ tab, search, tag });

  return (
    <div className="pb-12 sm:pb-16">
      {/* One content column: heading, toolbar and grid all sit on the same 1120px / 16px-gutter
          column, so their left (and right) edges line up. */}
      <div className="mx-auto max-w-[1120px] px-4 pt-8 sm:pt-12">
        <div className="space-y-2">
          <h1 className="font-serif text-[34px] sm:text-[48px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
            Explore recipes
          </h1>
          <p className="max-w-[60ch] text-[hsl(var(--ink-muted))]">
            Recipes from cooking videos, written out step by step — with credit to the cooks who made them.
          </p>
        </div>
      </div>

      <div ref={sentinel} aria-hidden className="h-4 sm:h-6" />
      <div
        className={cn(
          "no-print sticky z-30 border-b bg-[hsl(var(--background)/0.85)] backdrop-blur-md transition-colors",
          HEADER_OFFSET,
          stuck ? "border-[hsl(var(--border))]" : "border-transparent",
        )}
      >
        <div className="mx-auto flex max-w-[1120px] flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 sm:min-w-[16rem] sm:flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--ink-faint))]" />
            <input
              type="search"
              aria-label="Search recipes"
              placeholder="Search by title or ingredient"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className={cn(
                "w-full rounded-full border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] pl-10 pr-10 text-sm text-[hsl(var(--ink))] placeholder:text-[hsl(var(--ink-faint))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] [&::-webkit-search-cancel-button]:hidden",
                CONTROL_H,
              )}
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

          <div className="flex min-w-0 items-center gap-2 sm:flex-wrap" role="group" aria-label="Sort and filter">
            <SortTabs tab={tab} onChange={setTab} />
            <SortMenu tab={tab} onChange={setTab} />
            {TAG_GROUPS.map((g) => (
              <TagFilter key={g} group={g} tag={tag} onPick={setTag} />
            ))}
            <MobileTagFilter tag={tag} onPick={setTag} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1120px] space-y-4 px-4 pt-4 sm:pt-6">
        {newestForSearch && tab === "popular" && (
          <p className="text-xs text-[hsl(var(--ink-faint))]">Search results are shown newest first.</p>
        )}

        {error && (
          <p role="alert" className="text-sm text-[hsl(var(--danger))]">
            {error}
          </p>
        )}

        {items === null ? (
          <p className="text-sm text-[hsl(var(--ink-muted))]">Loading…</p>
        ) : items.length === 0 && !cursor ? (
          <div className="rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] px-6 py-10 text-center space-y-1">
            <p className="text-sm font-medium text-[hsl(var(--ink-muted))]">{empty.title}</p>
            <p className="text-sm text-[hsl(var(--ink-faint))]">{empty.hint}</p>
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
          <div className="flex justify-center pt-2">
            <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
