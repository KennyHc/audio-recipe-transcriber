import { useRef, useState } from "react";
import { useExampleRecipeHref } from "@/lib/useExampleRecipe";
import { UploadCloud, Loader2, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { backend } from "@/backend";
import { navigate, jobHref } from "@/lib/router";
import { routeIfNeedsSetup } from "@/lib/needsSetup";
import { parseSourceUrl } from "@/lib/sourceUrl";

const ACCEPTED_EXTENSIONS = [".mp3", ".m4a", ".wav", ".webm", ".ogg", ".mp4", ".aac", ".flac"];

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function UploadZone({
  onUploaded,
  disabled = false,
  disabledMessage,
  askSourceUrl = false,
}: {
  onUploaded: () => void;
  /** Cloud mode: an optional "Link to the video" field, sent with the recipe (prefills Publish). */
  askSourceUrl?: boolean;
  /** When true, the dropzone no longer accepts files (e.g. today's free quota is used up). */
  disabled?: boolean;
  /** Shown in place of the normal headline/caption while `disabled` is true. */
  disabledMessage?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkText, setLinkText] = useState("");
  const exampleHref = useExampleRecipeHref(); // cloud mode only; null elsewhere
  const [linkTouched, setLinkTouched] = useState(false);
  const link = askSourceUrl ? parseSourceUrl(linkText) : ({ ok: true, url: null } as const);
  const linkError = !link.ok && (linkTouched || linkText.length > 12) ? link.error : null;

  function startUpload(file: File) {
    if (disabled) return;
    if (!link.ok) {
      setLinkTouched(true);
      setError("Fix the video link first — or clear it, it's optional.");
      return;
    }
    if (!hasAcceptedExtension(file.name)) {
      setError(
        `"${file.name}" doesn't look like a supported audio file. Try ${ACCEPTED_EXTENSIONS.join(", ")}.`,
      );
      return;
    }
    setError(null);
    setProgress(0);
    const { promise } = backend.uploadAudio(file, (fraction) => setProgress(fraction), { sourceUrl: link.url });
    promise
      .then((job) => {
        setProgress(null);
        setLinkText("");
        setLinkTouched(false);
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
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled) return;
          const file = e.dataTransfer.files?.[0];
          if (file) startUpload(file);
        }}
        className={cn(
          "group flex min-h-[120px] sm:min-h-[132px] items-center rounded-[12px] border-2 border-dashed px-4 py-4 transition-colors",
          disabled
            ? "cursor-not-allowed border-[hsl(var(--border))] bg-[hsl(var(--sunken))]"
            : "cursor-pointer",
          !disabled && dragging
            ? "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint))]"
            : !disabled &&
              "border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] hover:border-[hsl(var(--accent-fill))]/60 hover:bg-[hsl(var(--accent-tint))]/40",
        )}
        role="button"
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) startUpload(file);
            e.target.value = "";
          }}
        />
        {disabled ? (
          <div className="flex w-full flex-col items-center gap-2 text-center">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--sunken))] text-[hsl(var(--ink-faint))]">
              <UploadCloud className="h-4 w-4" />
            </span>
            <p className="max-w-[28ch] text-balance text-sm font-medium text-[hsl(var(--ink-muted))]">
              {disabledMessage ?? "Uploads are unavailable right now."}
            </p>
          </div>
        ) : progress !== null ? (
          <div className="flex w-full flex-col items-center gap-2 text-center">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent-tint))]">
              <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--accent-text))]" />
            </span>
            <div className="w-full max-w-xs space-y-1.5">
              <p className="text-xs text-[hsl(var(--ink-muted))]">
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
          <div className="flex w-full flex-col items-center gap-2 text-center">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))] transition-colors group-hover:bg-[hsl(var(--accent-tint-strong))]">
              <UploadCloud className="h-4 w-4" />
            </span>
            <p className="text-sm font-medium text-[hsl(var(--ink))]">Drop a cooking clip here</p>
            <p className="max-w-[26ch] text-balance text-xs text-[hsl(var(--ink-faint))]">
              MP3, M4A, WAV and more · up to 200 MB
            </p>
          </div>
        )}
      </div>
      {askSourceUrl && !disabled && (
        <div className="space-y-1">
          <label htmlFor="upload-source-url" className="text-xs font-medium text-[hsl(var(--ink-muted))]">
            Link to the video <span className="font-normal text-[hsl(var(--ink-faint))]">(optional)</span>
          </label>
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--ink-faint))]" />
            <input
              id="upload-source-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="YouTube, TikTok or any https:// link"
              value={linkText}
              disabled={progress !== null}
              onChange={(e) => {
                setLinkText(e.target.value);
                if (error && parseSourceUrl(e.target.value).ok) setError(null);
              }}
              onBlur={() => setLinkTouched(true)}
              aria-invalid={linkError ? true : undefined}
              aria-describedby={linkError ? "upload-source-url-error" : "upload-source-url-hint"}
              className={cn(
                "h-9 w-full rounded-[var(--radius-control)] border bg-[hsl(var(--surface))] pl-8 pr-3 text-sm text-[hsl(var(--ink))] placeholder:text-[hsl(var(--ink-faint))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                linkError ? "border-[hsl(var(--danger))]" : "border-[hsl(var(--border-strong))]",
              )}
            />
          </div>
          {linkError ? (
            <p id="upload-source-url-error" className="text-xs text-[hsl(var(--danger))]">
              {linkError}
            </p>
          ) : (
            <p id="upload-source-url-hint" className="text-xs text-[hsl(var(--ink-faint))]">
              Where the clip is from — makes publishing one click. Only you see it.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-[hsl(var(--danger))]">
          {error}
        </p>
      )}
      {exampleHref && progress === null && (
        <p className="text-xs text-[hsl(var(--ink-faint))]">
          No clip handy?{" "}
          <a href={exampleHref} className="font-medium text-[hsl(var(--accent-text))] underline-offset-4 hover:underline">
            See an example recipe
          </a>
        </p>
      )}
    </div>
  );
}
