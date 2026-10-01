import { useEffect, useState, useCallback } from "react";
import type { Job } from "@recipe/shared";
import { backend } from "@/backend";
import { hasApiKey } from "@/backend/settings";
import { UploadZone } from "@/components/UploadZone";
import { StatusBadge } from "@/components/StatusBadge";
import { jobHref, settingsHref } from "@/lib/router";
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
import { MoreHorizontal, Trash2, FileAudio, KeyRound } from "lucide-react";

export function Library() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);

  const needsSetup = backend.kind === "browser" && !hasApiKey();

  const refresh = useCallback(() => {
    backend
      .listJobs()
      .then(setJobs)
      .catch((err: unknown) => {
        if (routeIfNeedsSetup(err)) return;
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-10 sm:py-14 space-y-10">
      <div
        className="relative overflow-hidden rounded-[10px] px-1 py-2 space-y-2"
        style={{
          backgroundImage:
            "radial-gradient(80% 100% at 15% 0%, hsl(var(--accent-tint) / 0.6), transparent 65%)",
        }}
      >
        <h1 className="font-serif text-[34px] sm:text-[48px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
          Turn cooking audio into recipes
        </h1>
        <p className="text-[hsl(var(--ink-muted))] max-w-[60ch]">
          Upload one audio recording of someone talking through a recipe — get a structured,
          verifiable recipe back.
        </p>
      </div>

      {needsSetup ? (
        <a
          href={settingsHref()}
          className="flex items-center gap-3 rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] px-5 py-5 transition-colors hover:border-[hsl(var(--accent-fill))]/60"
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
        <UploadZone onUploaded={refresh} />
      )}

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
          <p className="text-sm text-[hsl(var(--ink-muted))]">
            No recipes yet — upload a clip above to get started.
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="group relative rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 transition-colors hover:border-[hsl(var(--border-strong))]"
              >
                <a href={jobHref(job.id)} className="block space-y-3 pr-6">
                  <FileAudio className="h-5 w-5 text-[hsl(var(--ink-faint))]" />
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
                      <span>{new Date(job.createdAt).toLocaleDateString()}</span>
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
