import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useExampleRecipeHref } from "@/lib/useExampleRecipe";
import { UploadCloud, Loader2, Link2, AudioLines, Captions, FileText, X, Check, AlertTriangle, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { backend } from "@/backend";
import { navigate, jobHref } from "@/lib/router";
import { routeIfNeedsSetup } from "@/lib/needsSetup";
import { parseSourceUrl } from "@/lib/sourceUrl";
import { detectVideo } from "@/lib/publish";
import { analyzeCaptions, CAPTION_FILE_EXTENSIONS, hasCaptionFileExtension, MAX_CAPTION_FILE_BYTES } from "@/lib/captions";
import { getPreferredUploadMode, setPreferredUploadMode, type UploadMode } from "@/lib/uploadMode";
import { readDeviceFacts } from "@/lib/deviceProfile";
import { track } from "@/lib/analytics";
import { Button } from "@/components/ui/button";

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

  // "Audio clip | Captions / transcript" (browser, hosted and cloud modes).
  const captionsAvailable = backend.canUseCaptions;
  const [mode, setModeState] = useState<UploadMode>(() => (captionsAvailable ? getPreferredUploadMode() : "audio"));
  const [isPhone] = useState(() => readDeviceFacts().mobile);
  function setMode(next: UploadMode) {
    setModeState(next);
    setPreferredUploadMode(next);
    setError(null);
  }
  const showCaptions = captionsAvailable && mode === "captions";

  function resetAfterStart() {
    setLinkText("");
    setLinkTouched(false);
  }

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
        resetAfterStart();
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
      {captionsAvailable && !disabled && (
        <div
          role="radiogroup"
          aria-label="What do you have?"
          className="grid grid-cols-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] p-0.5"
        >
          {(
            [
              { value: "audio", label: "Audio clip", full: "Audio clip", icon: AudioLines },
              // Short label: the card is ~150 px per option on a phone and in the desktop hero.
              { value: "captions", label: "Captions", full: "Captions / transcript", icon: Captions },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={mode === opt.value}
              aria-label={opt.full}
              title={opt.full}
              disabled={progress !== null}
              onClick={() => setMode(opt.value)}
              className={cn(
                "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] font-medium transition-colors",
                mode === opt.value
                  ? "bg-[hsl(var(--surface))] text-[hsl(var(--ink))] shadow-sm"
                  : "text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))]",
              )}
            >
              <opt.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
      {showCaptions && !disabled ? (
        <CaptionsPanel
          linksToVideo={askSourceUrl}
          beforeStart={() => {
            if (!link.ok) {
              setLinkTouched(true);
              return "Fix the video link first — or clear it, it's optional.";
            }
            return null;
          }}
          sourceUrl={link.ok ? link.url : null}
          onStarted={() => {
            resetAfterStart();
            onUploaded();
          }}
        />
      ) : (
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
      )}
      {captionsAvailable && !disabled && !showCaptions && isPhone && progress === null && (
        <button
          type="button"
          onClick={() => setMode("captions")}
          className="flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-[hsl(var(--accent-tint-strong))] bg-[hsl(var(--accent-tint))] px-3 py-2 text-left text-xs text-[hsl(var(--accent-text))] transition-colors hover:bg-[hsl(var(--accent-tint-strong))]"
        >
          <Smartphone className="h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">Faster on phones:</span> paste the video's captions instead — no download, no waiting.
          </span>
        </button>
      )}
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
              {showCaptions
                ? "The video the captions are from — makes publishing one click. Only you see it."
                : "Where the clip is from — makes publishing one click. Only you see it."}
            </p>
          )}
        </div>
      )}
      {showCaptions && !disabled && <CaptionsHowTo link={askSourceUrl ? linkText : null} />}
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

/** Where to find captions: YouTube's "Show transcript" unless the link is clearly another site. */
function CaptionsHowTo({ link }: { link: string | null }) {
  const platform = link && link.trim() ? detectVideo(link)?.platform ?? null : null;
  if (platform && platform !== "youtube") {
    return (
      <p className="text-xs text-[hsl(var(--ink-faint))]">
        Look for the video's transcript or captions (CC) on its page and copy the text.
      </p>
    );
  }
  return (
    <p className="text-xs text-[hsl(var(--ink-faint))] text-pretty">
      <span className="font-medium text-[hsl(var(--ink-muted))]">On YouTube:</span> under the video, open the
      description (…more) and choose <span className="font-medium text-[hsl(var(--ink-muted))]">Show transcript</span>,
      then select the lines and copy them. Easiest on a computer.
    </p>
  );
}

function CaptionsPanel({
  linksToVideo,
  sourceUrl,
  beforeStart,
  onStarted,
}: {
  linksToVideo: boolean;
  sourceUrl: string | null;
  /** Returns an error to show instead of starting (e.g. the shared video link is invalid). */
  beforeStart: () => string | null;
  onStarted: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferred = useDeferredValue(text);
  const analysis = useMemo(() => analyzeCaptions(deferred, { linksToVideo }), [deferred, linksToVideo]);

  async function pickFile(file: File) {
    setError(null);
    if (!hasCaptionFileExtension(file.name)) {
      setError(`"${file.name}" isn't a caption file. Choose an ${CAPTION_FILE_EXTENSIONS.join(" / ")} file.`);
      return;
    }
    if (file.size > MAX_CAPTION_FILE_BYTES) {
      setError("That file is too big for one recipe's captions (max 2 MB).");
      return;
    }
    try {
      setText(await file.text());
      setFileName(file.name);
    } catch {
      setError("Couldn't read that file.");
    }
  }

  async function makeRecipe() {
    const blocked = beforeStart();
    if (blocked) {
      setError(blocked);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const job = await backend.createFromCaptions({ text, fileName }, { sourceUrl });
      track("captions_used");
      setText("");
      setFileName(null);
      onStarted();
      navigate(jobHref(job.id));
    } catch (err) {
      if (routeIfNeedsSetup(err)) return;
      setError(err instanceof Error ? err.message : "Couldn't start the recipe.");
    } finally {
      setBusy(false);
    }
  }

  const current = text === deferred ? analysis : null; // don't show a stale verdict while typing
  const ready = current?.kind === "ok";

  return (
    <div className="space-y-2">
      <label htmlFor="captions-text" className="sr-only">
        Paste the video's transcript or captions
      </label>
      <textarea
        id="captions-text"
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value) setFileName(null);
          if (error) setError(null);
        }}
        rows={5}
        spellCheck={false}
        placeholder="Paste the video's transcript or captions"
        aria-describedby="captions-feedback"
        className="block min-h-[120px] w-full resize-y rounded-[12px] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] px-3 py-2.5 text-sm leading-relaxed text-[hsl(var(--ink))] placeholder:text-[hsl(var(--ink-faint))] focus-visible:border-[hsl(var(--accent-fill))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]/40"
      />
      <input
        ref={fileRef}
        type="file"
        accept={`${CAPTION_FILE_EXTENSIONS.join(",")},text/plain,text/vtt`}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pickFile(file);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {fileName ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] py-0.5 pl-2.5 pr-1 text-xs text-[hsl(var(--ink-muted))]">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{fileName}</span>
            <button
              type="button"
              aria-label="Remove file"
              onClick={() => {
                setFileName(null);
                setText("");
              }}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="text-xs text-[hsl(var(--ink-muted))] underline-offset-4 hover:text-[hsl(var(--ink))] hover:underline"
          >
            or choose an <span className="font-medium text-[hsl(var(--accent-text))]">.srt / .vtt / .txt</span> file
          </button>
        )}
        <Button size="sm" onClick={makeRecipe} disabled={!ready || busy} className="ml-auto">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {busy ? "Starting…" : "Make recipe"}
        </Button>
      </div>
      <div id="captions-feedback" aria-live="polite" className="min-h-[1rem]">
        {current?.kind === "ok" && (
          <p className="flex items-start gap-1.5 text-xs text-[hsl(var(--ink-muted))]">
            <Check className="mt-px h-3.5 w-3.5 shrink-0 text-[hsl(var(--accent-text))]" />
            <span>{current.message}</span>
          </p>
        )}
        {(current?.kind === "error" || current?.kind === "too_long") && (
          <p className="flex items-start gap-1.5 text-xs text-[hsl(var(--danger))]">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{current.message}</span>
          </p>
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
