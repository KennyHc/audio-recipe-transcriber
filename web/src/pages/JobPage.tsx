import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job, Recipe, RecipeVersionMeta, Transcript, VersionedRecipe } from "@recipe/shared";
import { TERMINAL_STATUSES } from "@recipe/shared";
import { backend, publicBank, type JobProgress } from "@/backend";
import { navigate, jobHref, cookHref } from "@/lib/router";
import { routeIfNeedsSetup } from "@/lib/needsSetup";
import { Stepper } from "@/components/Stepper";
import { RecipeView } from "@/components/RecipeView";
import { EditRecipe } from "@/components/EditRecipe";
import { VersionHistory } from "@/components/VersionHistory";
import { AudioPlayer } from "@/components/AudioPlayer";
import { TranscriptView } from "@/components/TranscriptView";
import { ServingsScaler } from "@/components/ServingsScaler";
import { UnitsToggle } from "@/components/UnitsToggle";
import { CookMode, type CookModeHandle } from "@/components/cook/CookMode";
import { decideCookRouteAction } from "@/lib/cook";
import { ModelDownloadDialog } from "@/components/ModelDownloadDialog";
import { findSpeechModelOption, DEFAULT_SPEECH_MODEL, type SpeechModelOption } from "@/backend/browser/modelCatalog";
import { getBrowserSettings, saveBrowserSettings } from "@/backend/settings";
import { useWakeLock } from "@/lib/processingHealth";
import { AudioAvailableContext } from "@/lib/audioAvailability";
import { IS_CLOUD } from "@/lib/mode";
import { isCaptionsJob } from "@/lib/captions";
import { setPreferredUploadMode } from "@/lib/uploadMode";
import { readDeviceFacts } from "@/lib/deviceProfile";
import { detectVideo } from "@/lib/publish";
import { PublishControls } from "@/components/publish/PublishControls";
import { AddToShoppingListButton } from "@/components/shopping/AddToShoppingListButton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UnitSystem } from "@/lib/units";
import { recipeToMarkdown } from "@/lib/markdown";
import { formatDuration, formatTimestamp } from "@/lib/format";
import {
  ArrowLeft,
  Pencil,
  History,
  RefreshCw,
  Copy,
  Printer,
  AlertTriangle,
  Check,
  Clock,
  MoreHorizontal,
  ChefHat,
  PlayCircle,
  Smartphone,
} from "lucide-react";

const SETUP_WHISPER_COMMAND_RE = /`(npm run setup:whisper)`/;

/** Renders a job's error message, surfacing the setup:whisper command as a readable code chip. */
function JobErrorMessage({ error }: { error: string }) {
  const match = SETUP_WHISPER_COMMAND_RE.exec(error);
  if (!match) {
    return <p className="text-sm">{error}</p>;
  }
  return (
    <div className="text-sm space-y-1">
      <p>Download the speech-to-text model, then press Retry.</p>
      <code className="inline-block rounded bg-[hsl(var(--sunken))] px-2 py-1 font-mono text-xs">
        {match[1]}
      </code>
    </div>
  );
}

export function JobPage({ jobId, cookRoute }: { jobId: string; cookRoute: boolean }) {
  const [job, setJob] = useState<Job | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const transcriptFetchedRef = useRef(false);

  const [latest, setLatest] = useState<VersionedRecipe | null>(null);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null);
  const [viewingMeta, setViewingMeta] = useState<RecipeVersionMeta | null>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [unitSystem, setUnitSystem] = useState<UnitSystem>("original");
  const [scaleFactor, setScaleFactor] = useState(1);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());

  const [cookOpen, setCookOpen] = useState(cookRoute);
  const openedCookViaPushRef = useRef(false);
  const interceptedBackRef = useRef(false);
  const cookHasActiveTimersRef = useRef(false);
  const cookModeRef = useRef<CookModeHandle>(null);

  function toggleIngredient(i: number) {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function openCook() {
    openedCookViaPushRef.current = true;
    navigate(cookHref(jobId));
    setCookOpen(true);
  }
  function closeCook() {
    if (interceptedBackRef.current) {
      // A browser-back navigation was intercepted (timers were running) and we
      // restored the /cook hash ourselves; land cleanly on the plain job hash
      // without pushing or popping any further history entries.
      interceptedBackRef.current = false;
      window.history.replaceState(null, "", jobHref(jobId));
    } else if (openedCookViaPushRef.current) {
      window.history.back();
    } else {
      navigate(jobHref(jobId));
    }
    openedCookViaPushRef.current = false;
    setCookOpen(false);
  }

  // Keep cookOpen in sync with the route, but guard against losing running timers to a
  // stray browser-back: if the hash moves off /cook while timers are active, restore the
  // /cook hash (replacing, so history doesn't grow) and ask cook mode to confirm instead
  // of unmounting it outright.
  useEffect(() => {
    const action = decideCookRouteAction({
      cookRoute,
      cookOpen,
      hasActiveTimers: cookHasActiveTimersRef.current,
    });
    switch (action) {
      case "open":
        setCookOpen(true);
        break;
      case "close":
        setCookOpen(false);
        break;
      case "confirm-and-restore":
        interceptedBackRef.current = true;
        window.history.replaceState(null, "", cookHref(jobId));
        cookModeRef.current?.requestCloseWithConfirm();
        break;
      case "noop":
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cookRoute]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [reextractConfirmOpen, setReextractConfirmOpen] = useState(false);
  const [reextracting, setReextracting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"recipe" | "transcript">("recipe");
  const [copyOk, setCopyOk] = useState(false);

  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  // Cloud mode: false when the audio is on the device the recipe was uploaded from, not this one.
  const [audioAvailable, setAudioAvailable] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [progress, setProgress] = useState<JobProgress | null>(null);

  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const autoPromptedRef = useRef(false);

  // Keep the screen awake, and show a quiet "keep this tab in front" tip, while the browser
  // backend is actually doing work (downloading the model or running inference) — not while
  // merely queued/waiting for model-download consent, where nothing is happening yet.
  const isProcessing = job?.status === "transcribing" || job?.status === "extracting" || job?.status === "verifying";
  useWakeLock(isProcessing);

  // Made from pasted captions: there is no audio anywhere (no player, no click-to-hear), and
  // nothing to re-transcribe.
  const fromCaptions = job ? isCaptionsJob(job) : false;
  const canPlayAudio = audioAvailable && !fromCaptions;
  const [isPhone] = useState(() => readDeviceFacts().mobile);
  // Cloud: the owner's video link, for "Watch the video" on a captions recipe from YouTube.
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  useEffect(() => {
    setVideoUrl(null);
    if (!publicBank || !fromCaptions || job?.status !== "done") return;
    let cancelled = false;
    publicBank
      .getSourceUrl(jobId)
      .then((url) => {
        if (!cancelled) setVideoUrl(url && detectVideo(url)?.platform === "youtube" ? url : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [jobId, fromCaptions, job?.status]);

  // The first time this job is seen waiting for model-download consent, open the dialog
  // automatically. If the visitor cancels, autoPromptedRef stays true so we don't re-open it
  // on every subsequent 1s poll tick — they see the "Waiting for speech model — Download"
  // button instead, and can reopen the dialog from there.
  useEffect(() => {
    if (progress?.awaitingModelConsent && !autoPromptedRef.current) {
      autoPromptedRef.current = true;
      setModelDialogOpen(true);
    }
  }, [progress?.awaitingModelConsent]);

  const loadRecipe = useCallback(() => {
    backend
      .getRecipe(jobId)
      .then(setLatest)
      .catch(() => {
        /* recipe not ready yet */
      });
  }, [jobId]);

  const loadTranscript = useCallback(() => {
    backend
      .getTranscript(jobId)
      .then(setTranscript)
      .catch(() => {
        /* transcript not ready */
      });
  }, [jobId]);

  // Poll the job until it reaches a terminal state.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let lastStatus: Job["status"] | null = null;
    setJustFinished(false);
    transcriptFetchedRef.current = false;
    setJob(null);
    setLatest(null);
    setTranscript(null);
    setViewingVersion(null);
    setUnitSystem("original");
    setScaleFactor(1);
    setCheckedIngredients(new Set());
    setAudioAvailable(true);
    // Follow the route rather than forcing closed: this effect runs after the
    // cookRoute effect on mount, so `false` here broke deep links to #/jobs/:id/cook.
    setCookOpen(cookRoute);
    openedCookViaPushRef.current = false;
    interceptedBackRef.current = false;
    cookHasActiveTimersRef.current = false;
    autoPromptedRef.current = false;
    setModelDialogOpen(false);

    async function tick() {
      try {
        const j = await backend.getJob(jobId);
        if (cancelled) return;
        setJob(j);
        setLoadError(null);
        setProgress(TERMINAL_STATUSES.includes(j.status) ? null : backend.getProgress(jobId));

        if (!transcriptFetchedRef.current && j.status !== "queued" && j.status !== "transcribing") {
          transcriptFetchedRef.current = true;
          loadTranscript();
        }
        if (j.status === "done") {
          loadRecipe();
          // Finished while we watched (not opened already done): offer to share it.
          if (lastStatus !== null && lastStatus !== "done" && lastStatus !== "error") setJustFinished(true);
        }
        lastStatus = j.status;
        if (TERMINAL_STATUSES.includes(j.status) && interval) {
          clearInterval(interval);
          interval = null;
        }
      } catch (err) {
        if (cancelled) return;
        if (routeIfNeedsSetup(err)) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load job");
      }
    }

    tick();
    interval = setInterval(tick, 1000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [jobId, pollKey, loadRecipe, loadTranscript]);

  // Fetch a specific historical version when the user chooses to preview one.
  useEffect(() => {
    if (viewingVersion === null) return;
    backend
      .getVersion(jobId, viewingVersion)
      .then((vr) => {
        setViewingRecipe(vr.recipe);
        setViewingMeta(vr.meta);
      })
      .catch((err: unknown) => setSaveError(err instanceof Error ? err.message : "Failed to load version"));
  }, [jobId, viewingVersion]);

  // Track audio playback position for step/segment highlighting.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(el.currentTime);
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [job?.status]);

  // Track audio duration for the header's quiet stats line — no extra request, just
  // reading metadata off the same hidden <audio> element the player already drives.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onDuration = () => setAudioDuration(Number.isFinite(el.duration) ? el.duration : null);
    el.addEventListener("durationchange", onDuration);
    el.addEventListener("loadedmetadata", onDuration);
    onDuration();
    return () => {
      el.removeEventListener("durationchange", onDuration);
      el.removeEventListener("loadedmetadata", onDuration);
    };
  }, [job?.status]);

  function seekTo(seconds: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    el.play().catch(() => {
      /* autoplay may be blocked; user can press play manually */
    });
  }

  async function handleSave(recipe: Recipe) {
    setSaving(true);
    setSaveError(null);
    try {
      const vr = await backend.putRecipe(jobId, recipe);
      setLatest(vr);
      setViewingVersion(null);
      setEditing(false);
    } catch (err) {
      if (routeIfNeedsSetup(err)) return;
      setSaveError(err instanceof Error ? err.message : "Failed to save recipe");
    } finally {
      setSaving(false);
    }
  }

  async function handleReextract() {
    setReextracting(true);
    try {
      const j = await backend.reextract(jobId);
      setJob(j);
      setViewingVersion(null);
      setReextractConfirmOpen(false);
      setPollKey((k) => k + 1);
    } catch (err) {
      if (routeIfNeedsSetup(err)) return;
      setSaveError(err instanceof Error ? err.message : "Failed to re-extract");
    } finally {
      setReextracting(false);
    }
  }

  /** Called by TranscriptView once it has saved the corrected transcript and kicked off
   * `reextract` itself — this just resumes the existing polling/stepper and switches back
   * to the Recipe tab so the user watches Extracting → Checking → Done on the new version. */
  function handleTranscriptReextracted(j: Job) {
    setJob(j);
    setViewingVersion(null);
    setActiveTab("recipe");
    setPollKey((k) => k + 1);
  }

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const j = await backend.retry(jobId);
      setJob(j);
      setViewingVersion(null);
      setPollKey((k) => k + 1);
    } catch (err) {
      if (routeIfNeedsSetup(err)) return;
      setRetryError(err instanceof Error ? err.message : "Failed to retry");
    } finally {
      setRetrying(false);
    }
  }

  async function handleModelDownload(option: SpeechModelOption) {
    saveBrowserSettings({ ...getBrowserSettings(), whisperModel: option.repoId, whisperDtype: option.dtype });
    try {
      const j = await backend.resumeAfterModelConsent(jobId);
      setJob(j);
      setPollKey((k) => k + 1);
    } catch (err) {
      if (routeIfNeedsSetup(err)) return;
      setRetryError(err instanceof Error ? err.message : "Failed to start the download");
    }
  }

  function handleModelCancel() {
    // No-op: the job stays paused (see progress.awaitingModelConsent) with a visible
    // "Waiting for speech model — Download" button rather than erroring.
  }

  function handleCopyMarkdown() {
    if (!displayedRecipe) return;
    const scaledServings =
      displayedRecipe.servings !== null
        ? Math.max(1, Math.round(displayedRecipe.servings * scaleFactor))
        : null;
    const md = recipeToMarkdown(displayedRecipe, unitSystem, scaleFactor, scaledServings);
    navigator.clipboard
      .writeText(md)
      .then(() => {
        setCopyOk(true);
        setTimeout(() => setCopyOk(false), 2000);
      })
      .catch(() => {
        /* clipboard may be unavailable */
      });
  }

  const displayedRecipe = viewingVersion !== null ? viewingRecipe : latest?.recipe ?? null;
  const displayedMeta = viewingVersion !== null ? viewingMeta : latest?.meta ?? null;
  const isViewingOld =
    viewingVersion !== null && latest !== null && viewingVersion !== latest.meta.version;

  const activeStepText = useMemo(() => {
    if (!displayedRecipe || currentTime === null) return null;
    let active: string | null = null;
    for (const step of displayedRecipe.steps) {
      if (step.timestamp !== null && step.timestamp <= currentTime) active = step.text;
    }
    return active;
  }, [displayedRecipe, currentTime]);

  if (loadError && !job) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center space-y-3">
        <AlertTriangle className="h-8 w-8 mx-auto text-[hsl(var(--danger))]" />
        <p className="text-[hsl(var(--danger))]">{loadError}</p>
        <Button variant="outline" onClick={() => navigate("#/")}>
          <ArrowLeft className="h-4 w-4" /> Back to library
        </Button>
      </div>
    );
  }

  if (!job) {
    return <div className="mx-auto max-w-[1120px] px-4 py-10 text-[hsl(var(--ink-muted))]">Loading…</div>;
  }

  return (
    <div
      className={
        job.status === "done" && canPlayAudio
          ? "mx-auto max-w-[1120px] px-4 py-6 pb-24 space-y-6"
          : "mx-auto max-w-[1120px] px-4 py-6 pb-6 space-y-6"
      }
    >
      <a
        href="#/"
        className="no-print inline-flex items-center gap-1 text-sm text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to library
      </a>

      {job.status !== "done" && (
        <div className="rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 sm:p-8 space-y-4">
          <p className="text-sm font-medium text-[hsl(var(--ink))] truncate">
            {job.title ?? job.fileName}
          </p>
          <Stepper status={job.status} fromCaptions={fromCaptions} />
          {progress?.awaitingModelConsent ? (
            <div className="space-y-2">
              <p className="text-sm text-[hsl(var(--ink-muted))]">{progress.label}</p>
              <Button size="sm" onClick={() => setModelDialogOpen(true)}>
                Download
              </Button>
            </div>
          ) : progress ? (
            <div className="space-y-1.5">
              {/* progress.label already includes the percentage-equivalent detail (byte
                  counts, rate, ETA) for the download stage — see lib/downloadProgress.ts —
                  so it's shown as-is, without an extra "— NN%" appended. */}
              <p className="text-sm text-[hsl(var(--ink-muted))]">{progress.label}</p>
              {progress.detail && <p className="text-sm font-medium text-[hsl(var(--ink))]">{progress.detail}</p>}
              {progress.fraction !== null && (
                <div className="h-1 w-full max-w-sm rounded-full bg-[hsl(var(--sunken))] overflow-hidden">
                  <div
                    className="h-full bg-[hsl(var(--accent-fill))] transition-[width]"
                    style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                  />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-[hsl(var(--ink-muted))]">This usually takes 1–3 minutes.</p>
          )}
          {isProcessing && !progress?.detail && !fromCaptions && (
            <p className="text-xs text-[hsl(var(--ink-faint))]">
              Keep this tab open and in front — background tabs process more slowly.
            </p>
          )}
          {job.status === "transcribing" && isPhone && !fromCaptions && backend.canUseCaptions && (
            <a
              href="#/"
              onClick={() => setPreferredUploadMode("captions")}
              className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--accent-text))] underline-offset-4 hover:underline"
            >
              <Smartphone className="h-3.5 w-3.5 shrink-0" />
              Faster on phones: paste the video's captions instead
            </a>
          )}
        </div>
      )}

      <ModelDownloadDialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        defaultOption={findSpeechModelOption(getBrowserSettings().whisperModel, getBrowserSettings().whisperDtype) ?? DEFAULT_SPEECH_MODEL}
        onDownload={handleModelDownload}
        onCancel={handleModelCancel}
      />

      {job.status === "error" && (
        <div className="rounded-[10px] border border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/10 p-4 space-y-3">
          <p className="flex items-center gap-2 font-medium text-[hsl(var(--danger))]">
            <AlertTriangle className="h-4 w-4" /> Something went wrong
          </p>
          {job.error && <JobErrorMessage error={job.error} />}
          {retryError && <p className="text-sm text-[hsl(var(--danger))]">{retryError}</p>}
          <div className="flex gap-2">
            {IS_CLOUD ? (
              // Cloud: Retry sends the saved transcript again (or transcribes again if there's none).
              <Button size="sm" onClick={handleRetry} disabled={retrying}>
                <RefreshCw className="h-4 w-4" /> {retrying ? "Retrying…" : "Retry"}
              </Button>
            ) : fromCaptions ? (
              // No audio to start over from: Retry makes the recipe again from the captions.
              <Button size="sm" onClick={handleRetry} disabled={retrying}>
                <RefreshCw className="h-4 w-4" /> {retrying ? "Retrying…" : "Retry"}
              </Button>
            ) : transcript ? (
              <>
                <Button size="sm" onClick={() => setReextractConfirmOpen(true)}>
                  <RefreshCw className="h-4 w-4" /> Re-extract
                </Button>
                <Button size="sm" variant="outline" onClick={handleRetry} disabled={retrying}>
                  <RefreshCw className="h-4 w-4" /> {retrying ? "Starting over…" : "Start over from audio"}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={handleRetry} disabled={retrying}>
                <RefreshCw className="h-4 w-4" /> {retrying ? "Retrying…" : "Retry"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => navigate("#/")}>
              Back to library
            </Button>
          </div>
        </div>
      )}

      {job.status === "done" && displayedRecipe && (
        <AudioAvailableContext.Provider value={canPlayAudio}>
          {isViewingOld && displayedMeta && (
            <div className="no-print flex items-center justify-between rounded-[10px] border border-[hsl(var(--accent-tint-strong))] bg-[hsl(var(--accent-tint))] px-4 py-2 text-sm">
              <span className="text-[hsl(var(--accent-text))]">
                Viewing v{displayedMeta.version} — not current
              </span>
              <Button size="sm" variant="outline" onClick={() => setViewingVersion(null)}>
                Back to current
              </Button>
            </div>
          )}

          {saveError && <p className="text-sm text-[hsl(var(--danger))]">{saveError}</p>}

          {editing ? (
            <EditRecipe
              recipe={displayedRecipe}
              saving={saving}
              onCancel={() => setEditing(false)}
              onSave={handleSave}
            />
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "recipe" | "transcript")}>
              <div
                className="print-area relative overflow-hidden rounded-[14px] border border-[hsl(var(--border))] px-5 pt-6 print:pb-6 sm:px-7 sm:pt-7 sm:print:pb-7 space-y-4"
                style={{
                  backgroundImage:
                    "radial-gradient(80% 140% at 100% -20%, hsl(var(--accent-fill) / 0.08), transparent 70%), radial-gradient(50% 90% at 88% 0%, hsl(var(--accent-fill) / 0.06), transparent 75%), linear-gradient(180deg, hsl(var(--accent-tint) / 0.4), hsl(var(--background)))",
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2 max-w-[65ch]">
                    <h1 className="font-serif text-[34px] sm:text-[44px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
                      {displayedRecipe.title}
                    </h1>
                    {displayedRecipe.description && (
                      <p className="text-[hsl(var(--ink-muted))]">{displayedRecipe.description}</p>
                    )}
                    {fromCaptions ? (
                      <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <p className="text-xs text-[hsl(var(--ink-faint))]">Made from the video's captions.</p>
                        {videoUrl && (
                          <a
                            href={videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--accent-text))] underline-offset-4 hover:underline"
                          >
                            <PlayCircle className="h-4 w-4" /> Watch the video
                          </a>
                        )}
                      </div>
                    ) : (
                      !audioAvailable && (
                        <p className="no-print text-xs text-[hsl(var(--ink-faint))]">
                          The audio for this recipe is on the device you uploaded it from.
                        </p>
                      )
                    )}
                    <p className="text-xs tabular-nums text-[hsl(var(--ink-faint))]">
                      {[
                        `${displayedRecipe.ingredients.length} ingredient${displayedRecipe.ingredients.length === 1 ? "" : "s"}`,
                        `${displayedRecipe.steps.length} step${displayedRecipe.steps.length === 1 ? "" : "s"}`,
                        audioDuration !== null ? `${formatTimestamp(audioDuration)} audio` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {IS_CLOUD && !isViewingOld && (
                      <div className="pt-1">
                        <PublishControls recipeId={jobId} privateVersion={latest?.meta.version ?? null} justFinished={justFinished} />
                      </div>
                    )}
                  </div>

                  <div className="no-print flex items-center gap-2 shrink-0">
                    {!isViewingOld && (
                      <Button size="sm" onClick={openCook}>
                        <ChefHat className="h-3.5 w-3.5" /> Cook
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isViewingOld}
                      onClick={() => setEditing(true)}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="More actions"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-[hsl(var(--border-strong))] text-[hsl(var(--ink-muted))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                          <History className="h-3.5 w-3.5" /> History
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={!transcript}
                          onSelect={() => setReextractConfirmOpen(true)}
                          className="flex-col items-start gap-0.5"
                        >
                          <span className="flex items-center gap-2">
                            <RefreshCw className="h-3.5 w-3.5" /> Re-extract
                          </span>
                          <span className="pl-[22px] text-[11px] font-normal text-[hsl(var(--ink-faint))]">
                            Uses Claude — creates a new version
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={handleCopyMarkdown}>
                          {copyOk ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copyOk ? "Copied" : "Copy as Markdown"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => window.print()}>
                          <Printer className="h-3.5 w-3.5" /> Print
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="no-print flex flex-wrap items-center gap-2">
                  <div className="inline-flex flex-wrap items-center gap-1.5">
                    <ServingsScaler
                      originalServings={displayedRecipe.servings}
                      factor={scaleFactor}
                      onFactorChange={setScaleFactor}
                    />
                    <UnitsToggle value={unitSystem} onChange={setUnitSystem} />
                  </div>
                  {displayedRecipe.totalTimeMinutes !== null && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] px-3 py-1 text-sm text-[hsl(var(--ink-muted))]">
                      <Clock className="h-3.5 w-3.5" /> {formatDuration(displayedRecipe.totalTimeMinutes)}
                    </span>
                  )}
                </div>
                {displayedRecipe.totalTimeMinutes !== null && (
                  <p className="hidden print:block text-sm text-[hsl(var(--ink-muted))]">
                    Total time: {formatDuration(displayedRecipe.totalTimeMinutes)}
                  </p>
                )}

                <TabsList className="no-print flex -mx-5 sm:-mx-7 mt-2 border-b-0 border-t border-[hsl(var(--border))] px-5 pt-1 sm:px-7">
                  <TabsTrigger value="recipe">Recipe</TabsTrigger>
                  <TabsTrigger value="transcript" disabled={!transcript}>
                    Transcript
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="recipe">
                <RecipeView
                  recipe={displayedRecipe}
                  unitSystem={unitSystem}
                  scaleFactor={scaleFactor}
                  onSeek={seekTo}
                  currentTime={currentTime}
                  checkedIngredients={checkedIngredients}
                  onToggleIngredient={toggleIngredient}
                  ingredientsAction={
                    <AddToShoppingListButton
                      recipeId={jobId}
                      title={displayedRecipe.title}
                      isPublic={false}
                      ingredients={displayedRecipe.ingredients}
                      scaleFactor={scaleFactor}
                    />
                  }
                />
              </TabsContent>
              <TabsContent value="transcript">
                {transcript && (
                  <TranscriptView
                    jobId={jobId}
                    transcript={transcript}
                    currentTime={currentTime}
                    onSeek={seekTo}
                    canEdit={!isViewingOld}
                    onTranscriptSaved={setTranscript}
                    onReextracted={handleTranscriptReextracted}
                  />
                )}
              </TabsContent>
            </Tabs>
          )}

          <VersionHistory
            jobId={jobId}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            currentVersion={latest?.meta.version ?? null}
            onView={setViewingVersion}
            onRestored={() => {
              loadRecipe();
              setViewingVersion(null);
            }}
          />

          {fromCaptions ? (
            // Keeps the ref valid for cook mode; there is nothing to play.
            <audio ref={audioRef} preload="none" className="hidden" />
          ) : (
            <AudioPlayer
              ref={audioRef}
              jobId={jobId}
              title={job.title ?? job.fileName}
              activeStepText={activeStepText}
              onAvailabilityChange={setAudioAvailable}
            />
          )}

          {cookOpen && !editing && !isViewingOld && (
            <CookMode
              ref={cookModeRef}
              recipe={displayedRecipe}
              unitSystem={unitSystem}
              scaleFactor={scaleFactor}
              checkedIngredients={checkedIngredients}
              onToggleIngredient={toggleIngredient}
              audioRef={audioRef}
              onClose={closeCook}
              onActiveTimersChange={(active) => {
                cookHasActiveTimersRef.current = active;
              }}
            />
          )}
        </AudioAvailableContext.Provider>
      )}

      <Dialog open={reextractConfirmOpen} onOpenChange={setReextractConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-extract this recipe?</DialogTitle>
            <DialogDescription>
              This re-runs extraction and checking on the same saved transcript and creates a new
              version. It won't delete or overwrite any edits you've made — you can always restore
              them from History.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleReextract} disabled={reextracting}>
              {reextracting ? "Re-extracting…" : "Re-extract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
