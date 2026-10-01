import { useEffect, useState } from "react";
import type { RecipeVersionMeta, VersionSource } from "@recipe/shared";
import { backend } from "@/backend";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";
import { History as HistoryIcon, RotateCcw, Eye } from "lucide-react";

const SOURCE_LABEL: Record<VersionSource, string> = {
  extracted: "Extracted",
  edited: "Edited",
  reextracted: "Re-extracted",
  rollback: "Restored",
};

export function VersionHistory({
  jobId,
  open,
  onOpenChange,
  currentVersion,
  onView,
  onRestored,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentVersion: number | null;
  onView: (version: number) => void;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<RecipeVersionMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    backend
      .listVersions(jobId)
      .then(setVersions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load versions"));
  }, [open, jobId]);

  async function restore(version: number) {
    setRestoring(version);
    try {
      await backend.rollback(jobId, version);
      onRestored();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore version");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HistoryIcon className="h-4 w-4" /> Version history
          </DialogTitle>
          <DialogDescription>
            Every edit and re-extraction is kept as its own version. Restoring copies an old
            version forward as the new latest — nothing is deleted.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>}

        {versions === null ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading…</p>
        ) : (
          <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
            {versions.map((v) => {
              const isCurrent = v.version === currentVersion;
              return (
                <li
                  key={v.version}
                  className="flex items-center gap-3 rounded-md border border-[hsl(var(--border))] px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium flex items-center gap-2">
                      v{v.version}
                      <Badge variant="outline">{SOURCE_LABEL[v.source]}</Badge>
                      {isCurrent && <Badge>Current</Badge>}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {formatRelativeTime(v.createdAt)}
                      {v.note ? ` — ${v.note}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onView(v.version);
                      onOpenChange(false);
                    }}
                  >
                    <Eye className="h-3.5 w-3.5" /> View
                  </Button>
                  {!isCurrent && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={restoring !== null}
                      onClick={() => restore(v.version)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {restoring === v.version ? "Restoring…" : "Restore"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
