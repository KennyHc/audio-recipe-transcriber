import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, EyeOff, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import type { AdminQueueResponse } from "@recipe/shared";
import { publicBank } from "@/backend";
import { formatFriendlyDate } from "@/lib/format";
import { publicHref } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { PublicStatusPill } from "@/components/publish/PublicStatusPill";
import { RecipeThumbnail, creditLine } from "@/components/public/PublicRecipeCard";

type Item = AdminQueueResponse["items"][number];
type Action = "hide" | "restore" | "dismiss";

const KIND_LABEL: Record<Item["report"]["kind"], string> = {
  report: "Report",
  claim: "Creator claim",
  screening: "Flagged by screening",
};

/** Moderation queue (admin accounts only — the API checks the admin claim). */
export function Admin() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!publicBank) return;
    setError(null);
    publicBank
      .adminQueue()
      .then((r) => setItems(r.items))
      .catch((err: unknown) => {
        setItems([]);
        setError(err instanceof Error ? err.message : "Couldn't load the queue.");
      });
  }, []);

  useEffect(load, [load]);

  async function act(item: Item, action: Action) {
    if (!publicBank) return;
    const key = `${item.report.id}:${action}`;
    setBusy(key);
    setError(null);
    try {
      await publicBank.adminAction(item.report.publicRecipeId, { action, reportId: item.report.id, note: null });
      setItems((prev) => (prev ?? []).filter((i) => i.report.id !== item.report.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-[880px] px-4 py-8 space-y-6">
      <a
        href="#/"
        className="inline-flex items-center gap-1 text-sm text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to library
      </a>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-serif text-[34px] sm:text-[40px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
            Moderation
          </h1>
          <p className="text-sm text-[hsl(var(--ink-muted))]">Open reports, creator claims, and publishes flagged by screening.</p>
        </div>
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[hsl(var(--danger))]">
          {error}
        </p>
      )}

      {items === null ? (
        <p className="text-sm text-[hsl(var(--ink-muted))]">Loading…</p>
      ) : items.length === 0 ? (
        !error && (
          <div className="rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] px-6 py-10 text-center">
            <p className="text-sm font-medium text-[hsl(var(--ink-muted))]">Nothing to review</p>
          </div>
        )
      ) : (
        <ul className="space-y-4">
          {items.map((item) => {
            const { report, publicRecipe: pub } = item;
            return (
              <li
                key={report.id}
                className="space-y-3 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-[hsl(var(--accent-tint-strong))] px-2 py-0.5 font-medium text-[hsl(var(--accent-text))]">
                    {KIND_LABEL[report.kind]}
                  </span>
                  <span className="text-[hsl(var(--ink-faint))]">{formatFriendlyDate(report.createdAt)}</span>
                  {report.reporterUid && <span className="text-[hsl(var(--ink-faint))]">· signed-in reporter</span>}
                </div>

                <p className="whitespace-pre-wrap text-sm text-[hsl(var(--ink))]">{report.reason}</p>
                {report.contact && (
                  <p className="text-sm text-[hsl(var(--ink-muted))]">
                    Contact:{" "}
                    <a href={`mailto:${report.contact}`} className="text-[hsl(var(--accent-text))] underline underline-offset-2">
                      {report.contact}
                    </a>
                  </p>
                )}

                {pub ? (
                  <a
                    href={publicHref(pub.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex gap-3 rounded-[8px] border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] p-2.5 hover:border-[hsl(var(--border-strong))]"
                  >
                    <span className="w-28 shrink-0 overflow-hidden rounded-[6px]">
                      <RecipeThumbnail src={pub.source.thumbnailUrl} />
                    </span>
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate font-medium text-[hsl(var(--ink))]">{pub.recipe.title}</span>
                      <span className="block truncate text-xs text-[hsl(var(--ink-muted))]">
                        {creditLine(pub)} · @{pub.handle}
                      </span>
                      <PublicStatusPill pub={pub} />
                    </span>
                  </a>
                ) : (
                  <p className="text-sm text-[hsl(var(--ink-faint))]">The recipe has since been deleted ({report.publicRecipeId}).</p>
                )}

                <div className="flex flex-wrap gap-2">
                  {pub && pub.status !== "hidden" && (
                    <Button size="sm" variant="destructive" onClick={() => act(item, "hide")} disabled={busy !== null}>
                      {busy === `${report.id}:hide` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
                      Hide
                    </Button>
                  )}
                  {pub && pub.status !== "live" && (
                    <Button size="sm" onClick={() => act(item, "restore")} disabled={busy !== null}>
                      {busy === `${report.id}:restore` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      Restore
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => act(item, "dismiss")} disabled={busy !== null}>
                    {busy === `${report.id}:dismiss` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    Dismiss
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
