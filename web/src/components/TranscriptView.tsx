import { useMemo, useState } from "react";
import type { Job, Transcript } from "@recipe/shared";
import { backend } from "@/backend";
import { routeIfNeedsSetup } from "@/lib/needsSetup";
import { IS_CLOUD, IS_HOSTED } from "@/lib/mode";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { changedSegmentIndices, buildEditedTranscript, hasUnsavedTranscriptEdits } from "@/lib/transcriptEdit";
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
import { Pencil, RefreshCw, Save, AlertTriangle } from "lucide-react";

/** A textarea that grows to fit its content, so a corrected segment never scrolls
 * inside a fixed box. Re-measures on every keystroke; cheap for the handful of
 * segments a transcript normally has. */
function AutoGrowTextarea({
  value,
  onChange,
  edited,
}: {
  value: string;
  onChange: (next: string) => void;
  edited: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      ref={(el) => {
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
      className={cn(
        "w-full resize-none overflow-hidden rounded-[var(--radius-control)] border bg-[hsl(var(--card))] px-2 py-1.5 text-sm leading-relaxed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        edited
          ? "border-[hsl(var(--accent-tint-strong))]"
          : "border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))]",
      )}
    />
  );
}

export function TranscriptView({
  jobId,
  transcript,
  currentTime,
  onSeek,
  canEdit,
  onTranscriptSaved,
  onReextracted,
}: {
  jobId: string;
  transcript: Transcript;
  currentTime: number | null;
  onSeek: (seconds: number) => void;
  /** False while a job is running or while viewing an older recipe version — the
   * "Edit transcript" entry point is hidden entirely in that case. */
  canEdit: boolean;
  /** Called after a plain "Save without re-extracting" succeeds, with the transcript
   * as saved, so the parent can update its own copy. */
  onTranscriptSaved: (transcript: Transcript) => void;
  /** Called after "Save & re-extract" kicks off re-extraction, with the Job returned
   * by `reextract` — the parent switches to the Recipe tab and resumes its existing
   * polling/stepper so the user watches Extracting → Checking → Done. */
  onReextracted: (job: Job) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [texts, setTexts] = useState<string[]>([]);
  const [busy, setBusy] = useState<"saving" | "reextracting" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const changedIndexes = useMemo(
    () => changedSegmentIndices(transcript.segments, texts),
    [transcript.segments, texts],
  );
  const hasChanges = changedIndexes.size > 0;

  function startEditing() {
    setTexts(transcript.segments.map((s) => s.text));
    setError(null);
    setEditing(true);
  }

  function requestCancel() {
    if (hasUnsavedTranscriptEdits(transcript.segments, texts)) {
      setDiscardConfirmOpen(true);
    } else {
      setEditing(false);
    }
  }

  function discardAndClose() {
    setDiscardConfirmOpen(false);
    setEditing(false);
    setError(null);
  }

  async function handleSaveOnly() {
    setBusy("saving");
    setError(null);
    try {
      const built = buildEditedTranscript(transcript, texts);
      const saved = await backend.putTranscript(jobId, built);
      onTranscriptSaved(saved);
      setEditing(false);
    } catch (err) {
      if (routeIfNeedsSetup(err)) return;
      setError(err instanceof Error ? err.message : "Failed to save transcript");
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveAndReextract() {
    setBusy("reextracting");
    setError(null);
    try {
      const built = buildEditedTranscript(transcript, texts);
      await backend.putTranscript(jobId, built);
      const job = await backend.reextract(jobId);
      setEditing(false);
      onReextracted(job);
    } catch (err) {
      if (routeIfNeedsSetup(err)) return;
      setError(err instanceof Error ? err.message : "Failed to save and re-extract");
    } finally {
      setBusy(null);
    }
  }

  if (transcript.segments.length === 0) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No transcript segments.</p>;
  }

  return (
    <div className="space-y-3">
      {!editing && canEdit && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={startEditing}>
            <Pencil className="h-3.5 w-3.5" /> Edit transcript
          </Button>
        </div>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-[hsl(var(--danger))]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="space-y-1">
        {transcript.segments.map((seg, i) => {
          const isActive =
            currentTime !== null && currentTime >= seg.start && currentTime < seg.end;
          const isChanged = changedIndexes.has(i);

          const timestampChip = (
            <button
              type="button"
              onClick={() => onSeek(seg.start)}
              className={cn(
                "mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums transition-colors",
                isActive
                  ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
                  : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--border-strong))]",
              )}
            >
              {formatTimestamp(seg.start)}
            </button>
          );

          if (!editing) {
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSeek(seg.start)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[hsl(var(--accent))]",
                  isActive && "bg-[hsl(var(--accent))]",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
                    isActive
                      ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
                      : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]",
                  )}
                >
                  {formatTimestamp(seg.start)}
                </span>
                <span className="text-sm leading-relaxed">{seg.text.trim()}</span>
              </button>
            );
          }

          return (
            <div key={i} className="flex items-start gap-3 rounded-md px-2 py-1.5">
              {timestampChip}
              <div className="flex-1 space-y-1">
                <AutoGrowTextarea
                  value={texts[i] ?? ""}
                  edited={isChanged}
                  onChange={(next) =>
                    setTexts((prev) => {
                      const copy = prev.slice();
                      copy[i] = next;
                      return copy;
                    })
                  }
                />
                {isChanged && (
                  <span className="inline-flex items-center rounded-full bg-[hsl(var(--accent-tint))] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--accent-text))]">
                    edited
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="sticky bottom-0 -mx-2 space-y-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-3">
          <p className="text-xs text-[hsl(var(--ink-faint))]">
            Saving and re-extracting creates a new recipe version from the corrected
            transcript — your previous versions stay in History.
            {IS_HOSTED && " Uses one of today's free recipes."}
            {IS_CLOUD && " Uses one of this month's recipes."}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={requestCancel} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveOnly}
              disabled={busy !== null || !hasChanges}
            >
              <Save className="h-3.5 w-3.5" />
              {busy === "saving" ? "Saving…" : "Save without re-extracting"}
            </Button>
            <Button size="sm" onClick={handleSaveAndReextract} disabled={busy !== null || !hasChanges}>
              <RefreshCw className="h-3.5 w-3.5" />
              {busy === "reextracting" ? "Re-extracting…" : "Save & re-extract"}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard your edits?</DialogTitle>
            <DialogDescription>
              You've changed {changedIndexes.size} segment{changedIndexes.size === 1 ? "" : "s"}.
              Leaving edit mode now discards those changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Keep editing</Button>
            </DialogClose>
            <Button variant="destructive" onClick={discardAndClose}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
