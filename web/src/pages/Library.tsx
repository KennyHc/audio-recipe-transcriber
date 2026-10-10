import { useEffect, useState, useCallback } from "react";
import type { Job, PublicRecipe, QuotaResponse } from "@recipe/shared";
import { backend, publicBank, type SavedEntry } from "@/backend";
import { hasApiKey } from "@/backend/settings";
import { IS_CLOUD, IS_HOSTED } from "@/lib/mode";
import { useAccountUser } from "@/lib/useAccount";
import { quotaExceededMessage } from "@/backend/cloud/errors";
import { MoveLocalRecipesPrompt } from "@/components/account/MoveLocalRecipesPrompt";
import { UploadZone } from "@/components/UploadZone";
import { StatusBadge } from "@/components/StatusBadge";
import { exploreHref, jobHref, privacyHref, settingsHref } from "@/lib/router";
import { PublicStatusPill } from "@/components/publish/PublicStatusPill";
import { PublicRecipeCard } from "@/components/public/PublicRecipeCard";
import { routeIfNeedsSetup } from "@/lib/needsSetup";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NoodlesLogo } from "@/components/NoodlesLogo";
import { formatFriendlyDate } from "@/lib/format";
import { MoreHorizontal, Trash2, KeyRound, UploadCloud, Laptop, ListChecks, BookmarkX } from "lucide-react";

/** "3 hours" / "1 hour" — same rounding as proxyClaude.ts's describeProxyError. */
function formatResetHours(seconds: number): string {
  const hours = Math.max(1, Math.round(seconds / 3600));
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export function Library() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  // Cloud mode: which of my recipes are published, and the public recipes I saved.
  const [published, setPublished] = useState<Map<string, PublicRecipe>>(new Map());
  const [saved, setSaved] = useState<SavedEntry[] | null>(null);
  const [removingSave, setRemovingSave] = useState<string | null>(null);

  const user = useAccountUser();

  // Hosted and cloud modes never need a key — Claude calls go through the operator's server.
  const needsSetup = backend.kind === "browser" && !IS_HOSTED && !IS_CLOUD && !hasApiKey();

  // Only non-null in hosted (per day) and cloud (per month) modes.
  const quotaExhausted = quota != null && quota.remaining <= 0;
  const quotaMessage = !quota
    ? null
    : IS_CLOUD
      ? quotaExhausted
        ? quotaExceededMessage(quota.limit, new Date(Date.now() + quota.resetsInSeconds * 1000))
        : `${quota.remaining} of ${quota.limit} recipes left this month`
      : quotaExhausted
        ? `You've used today's ${quota.limit} free recipes — more in ${formatResetHours(quota.resetsInSeconds)}`
        : `${quota.remaining} of ${quota.limit} free recipes left today`;

  const refresh = useCallback(() => {
    backend
      .listJobs()
      .then(setJobs)
      .catch((err: unknown) => {
        if (routeIfNeedsSetup(err)) return;
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      });
  }, []);

  const refreshPublic = useCallback(() => {
    if (!publicBank) return;
    publicBank
      .listOwnPublished()
      .then(setPublished)
      .catch(() => undefined);
    publicBank
      .listSaved()
      .then(setSaved)
      .catch(() => setSaved([]));
  }, []);

  async function removeSave(id: string) {
    if (!publicBank) return;
    setRemovingSave(id);
    try {
      await publicBank.setSave(id, false);
      setSaved((prev) => (prev ?? []).filter((e) => e.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove it. Please try again.");
    } finally {
      setRemovingSave(null);
    }
  }

  const refreshQuota = useCallback(() => {
    backend
      .getQuota()
      .then(setQuota)
      .catch(() => setQuota(null));
  }, []);

  // Refresh both on mount and whenever the Library is shown again (e.g. navigating back
  // from a job page) — this component remounts on each route change, so a plain mount
  // effect covers "returning to the library" too.
  useEffect(() => {
    refresh();
    refreshQuota();
    refreshPublic();
  }, [refresh, refreshQuota, refreshPublic]);

  // Cloud mode: recipes can be added from another device, so refresh when the tab comes
  // back into view (the list is served from Firestore's live cache, so this is cheap).
  useEffect(() => {
    if (!IS_CLOUD) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
        refreshQuota();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh, refreshQuota]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // A published recipe is unpublished first: the rules refuse to delete a private recipe
      // while its public snapshot exists.
      const wasPublished = published.has(deleteTarget.id);
      if (publicBank && wasPublished) {
        await publicBank.unpublish(deleteTarget.id);
      }
      try {
        await backend.deleteJob(deleteTarget.id);
      } catch (err) {
        // The published list may be stale (published from another device): unpublish, retry once.
        if (!publicBank || wasPublished) throw err;
        const pub = await publicBank.getPublicRecipe(deleteTarget.id).catch(() => null);
        if (!pub) throw err;
        await publicBank.unpublish(deleteTarget.id);
        await backend.deleteJob(deleteTarget.id);
      }
      setDeleteTarget(null);
      refresh();
      refreshPublic();
    } catch (err) {
      if (routeIfNeedsSetup(err)) return;
      setError(err instanceof Error ? err.message : "Failed to delete job");
    } finally {
      setDeleting(false);
    }
  }

  const howItWorks = [
    { icon: UploadCloud, text: "Drop a clip", short: "Drop a clip" },
    {
      icon: Laptop,
      text: backend.kind === "server" ? "Transcribed on this machine" : "Transcribed on your device",
      short: "Transcribed locally",
    },
    { icon: ListChecks, text: "A recipe you can check against the audio", short: "Check vs audio" },
  ];

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-6 sm:py-14 space-y-6 sm:space-y-10">
      <div
        className="relative overflow-hidden rounded-[14px] px-5 py-6 sm:px-10 sm:py-12 space-y-5 sm:space-y-8"
        style={{
          backgroundImage:
            "radial-gradient(70% 120% at 100% -10%, hsl(var(--accent-fill) / 0.14), transparent 70%), radial-gradient(45% 80% at 85% 0%, hsl(var(--accent-fill) / 0.1), transparent 75%), linear-gradient(180deg, hsl(var(--accent-tint) / 0.6), hsl(var(--background)))",
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 sm:gap-6 lg:items-center">
          <div className="space-y-3">
            <h1 className="font-serif text-[34px] sm:text-[48px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
              Turn cooking audio into recipes
            </h1>
            <p className="text-[hsl(var(--ink-muted))] max-w-[60ch]">
              Upload one audio recording of someone talking through a recipe — get a structured,
              verifiable recipe back.
            </p>
          </div>

          <div className="space-y-2">
            {needsSetup ? (
              <a
                href={settingsHref()}
                className="flex items-center gap-3 rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] px-4 py-4 transition-colors hover:border-[hsl(var(--accent-fill))]/60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
                  <KeyRound className="h-4 w-4" />
                </span>
                <span className="text-sm">
                  <span className="font-medium text-[hsl(var(--ink))]">
                    Add your Anthropic API key to start
                  </span>
                  <span className="text-[hsl(var(--ink-faint))]"> — it stays in this browser. Go to Settings.</span>
                </span>
              </a>
            ) : (
              <>
                <UploadZone
                  onUploaded={() => {
                    refresh();
                    refreshQuota();
                  }}
                  disabled={quotaExhausted}
                  disabledMessage={quotaMessage ?? undefined}
                />
                {quotaMessage && (
                  <p className="text-xs text-[hsl(var(--ink-faint))]">{quotaMessage}</p>
                )}
                {backend.kind === "browser" && (
                  <p className="text-xs text-[hsl(var(--ink-faint))]">
                    {IS_CLOUD
                      ? "Audio stays on your device. Only the transcript is sent to make the recipe, which is saved to your account."
                      : "Audio stays on your device. Only the transcript is sent to make the recipe."}{" "}
                    <a
                      href={privacyHref()}
                      className="text-[hsl(var(--ink-muted))] underline underline-offset-2 hover:text-[hsl(var(--ink))]"
                    >
                      Privacy
                    </a>
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Compact 3-up row on phones: icon above a 2–3 word label, so the hero doesn't
            push the first recipe card below the fold. Desktop keeps the fuller line. */}
        <div className="grid grid-cols-3 gap-2 border-t border-[hsl(var(--border))] pt-4 sm:hidden">
          {howItWorks.map(({ icon: Icon, short }, i) => (
            <div key={i} className="flex flex-col items-center gap-1 text-center">
              <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--accent-text))]" />
              <span className="text-[11px] leading-tight text-[hsl(var(--ink-muted))]">{short}</span>
            </div>
          ))}
        </div>
        <div className="hidden sm:grid sm:grid-cols-3 gap-4 sm:gap-6 border-t border-[hsl(var(--border))] pt-6">
          {howItWorks.map(({ icon: Icon, text }, i) => (
            <div key={i} className="flex items-center gap-2.5 text-sm text-[hsl(var(--ink-muted))]">
              <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--accent-text))]" />
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[hsl(var(--danger))]">
          {error}
        </p>
      )}

      {IS_CLOUD && user && <MoveLocalRecipesPrompt user={user} onMoved={refresh} />}

      <div className="space-y-3">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">
          Your recipes
        </h2>
        {jobs === null ? (
          <p className="text-sm text-[hsl(var(--ink-muted))]">Loading…</p>
        ) : jobs.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] px-6 py-10 text-center space-y-1">
            <p className="text-sm font-medium text-[hsl(var(--ink-muted))]">No recipes yet</p>
            <p className="text-sm text-[hsl(var(--ink-faint))]">
              Upload a clip above to get your first one.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="group relative rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-[hsl(var(--border-strong))] hover:shadow-[var(--shadow-float)]"
              >
                <a href={jobHref(job.id)} className="block space-y-3 pr-6">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
                    <NoodlesLogo className="h-5 w-5" />
                  </span>
                  <div className="space-y-1">
                    <p
                      className={
                        job.title
                          ? "font-serif text-xl leading-tight text-[hsl(var(--ink))] group-hover:text-[hsl(var(--accent-text))] transition-colors line-clamp-2"
                          : "font-medium text-[hsl(var(--ink-muted))] truncate"
                      }
                    >
                      {job.title ?? job.fileName}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--ink-faint))]">
                      <span>{formatFriendlyDate(job.createdAt)}</span>
                      <StatusBadge status={job.status} />
                      {published.get(job.id) && <PublicStatusPill pub={published.get(job.id)!} />}
                    </div>
                  </div>
                </a>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Actions for ${job.title ?? job.fileName}`}
                      className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[hsl(var(--ink-faint))] opacity-0 transition-opacity hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))] group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem destructive onSelect={() => setDeleteTarget(job)}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </div>

      {IS_CLOUD && saved !== null && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">Saved</h2>
            <a href={exploreHref()} className="text-sm text-[hsl(var(--accent-text))] underline-offset-4 hover:underline">
              Explore recipes
            </a>
          </div>
          {saved.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] px-6 py-8 text-center space-y-1">
              <p className="text-sm font-medium text-[hsl(var(--ink-muted))]">Nothing saved yet</p>
              <p className="text-sm text-[hsl(var(--ink-faint))]">Save recipes from Explore to find them here.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {saved.map((entry) => (
                <li key={entry.id}>
                  {entry.recipe ? (
                    <PublicRecipeCard pub={entry.recipe} />
                  ) : (
                    <div className="flex h-full flex-col justify-between gap-3 rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--sunken))] p-4">
                      <div className="space-y-1">
                        <p className="font-medium text-[hsl(var(--ink-muted))]">No longer available</p>
                        <p className="text-sm text-[hsl(var(--ink-faint))]">
                          This recipe was unpublished or taken down.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="self-start"
                        onClick={() => removeSave(entry.id)}
                        disabled={removingSave === entry.id}
                      >
                        <BookmarkX className="h-3.5 w-3.5" /> {removingSave === entry.id ? "Removing…" : "Remove"}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this recipe?</DialogTitle>
            <DialogDescription>
              This permanently deletes "{deleteTarget?.title ?? deleteTarget?.fileName}" and its
              audio, transcript, and all saved versions. This can't be undone.
              {deleteTarget && published.has(deleteTarget.id) &&
                " It's published, so it will also be removed from the public recipe bank."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
