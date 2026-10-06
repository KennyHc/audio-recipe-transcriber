import { useEffect, useState, useCallback } from "react";
import type { Job, QuotaResponse } from "@recipe/shared";
import { backend } from "@/backend";
import { hasApiKey } from "@/backend/settings";
import { IS_HOSTED } from "@/lib/mode";
import { UploadZone } from "@/components/UploadZone";
import { StatusBadge } from "@/components/StatusBadge";
import { jobHref, privacyHref, settingsHref } from "@/lib/router";
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
import { MoreHorizontal, Trash2, KeyRound, UploadCloud, Laptop, ListChecks } from "lucide-react";

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

  // Hosted mode never needs a key — Claude calls go through the operator's Worker.
  const needsSetup = backend.kind === "browser" && !IS_HOSTED && !hasApiKey();

  // Only non-null in hosted mode (backend.getQuota() returns null elsewhere).
  const quotaExhausted = quota != null && quota.remaining <= 0;
  const quotaMessage = quota
    ? quotaExhausted
      ? `You've used today's ${quota.limit} free recipes — more in ${formatResetHours(quota.resetsInSeconds)}`
      : `${quota.remaining} of ${quota.limit} free recipes left today`
    : null;

  const refresh = useCallback(() => {
    backend
      .listJobs()
      .then(setJobs)
      .catch((err: unknown) => {
        if (routeIfNeedsSetup(err)) return;
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      });
  }, []);

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
  }, [refresh, refreshQuota]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await backend.deleteJob(deleteTarget.id);
      setDeleteTarget(null);
      refresh();
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
                    Audio stays on your device. Only the transcript is sent to make the recipe.{" "}
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
                    <div className="flex items-center gap-2 text-xs text-[hsl(var(--ink-faint))]">
                      <span>{formatFriendlyDate(job.createdAt)}</span>
                      <StatusBadge status={job.status} />
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

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this recipe?</DialogTitle>
            <DialogDescription>
              This permanently deletes "{deleteTarget?.title ?? deleteTarget?.fileName}" and its
              audio, transcript, and all saved versions. This can't be undone.
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
