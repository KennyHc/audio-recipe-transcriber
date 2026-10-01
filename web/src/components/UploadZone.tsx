import { useRef, useState } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { backend } from "@/backend";
import { navigate, jobHref } from "@/lib/router";
import { routeIfNeedsSetup } from "@/lib/needsSetup";

const ACCEPTED_EXTENSIONS = [".mp3", ".m4a", ".wav", ".webm", ".ogg", ".mp4", ".aac", ".flac"];

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function UploadZone({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startUpload(file: File) {
    if (!hasAcceptedExtension(file.name)) {
      setError(
        `"${file.name}" doesn't look like a supported audio file. Try ${ACCEPTED_EXTENSIONS.join(", ")}.`,
      );
      return;
    }
    setError(null);
    setProgress(0);
    const { promise } = backend.uploadAudio(file, (fraction) => setProgress(fraction));
    promise
      .then((job) => {
        setProgress(null);
        onUploaded();
        navigate(jobHref(job.id));
      })
      .catch((err: unknown) => {
        setProgress(null);
        if (routeIfNeedsSetup(err)) return;
        setError(err instanceof Error ? err.message : "Upload failed");
      });
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) startUpload(file);
        }}
        className={cn(
          "rounded-[10px] border-2 border-dashed px-5 py-5 transition-colors cursor-pointer",
          dragging
            ? "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint))]"
            : "border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] hover:border-[hsl(var(--accent-fill))]/60",
        )}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) startUpload(file);
            e.target.value = "";
          }}
        />
        {progress !== null ? (
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(var(--accent-text))]" />
            <div className="flex-1 space-y-1.5">
              <p className="text-sm text-[hsl(var(--ink-muted))]">
                Uploading… {Math.round(progress * 100)}%
              </p>
              <div className="h-1.5 w-full rounded-full bg-[hsl(var(--sunken))] overflow-hidden">
                <div
                  className="h-full bg-[hsl(var(--accent-fill))] transition-[width]"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <UploadCloud className="h-5 w-5 shrink-0 text-[hsl(var(--accent-text))]" />
            <p className="text-sm">
              <span className="font-medium text-[hsl(var(--ink))]">
                Drop an audio file or browse
              </span>
              <span className="text-[hsl(var(--ink-faint))]">
                {" "}
                — mp3, m4a, wav, webm, ogg, mp4, aac, flac
              </span>
            </p>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-[hsl(var(--danger))]">
          {error}
        </p>
      )}
    </div>
  );
}
