import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job, Recipe, RecipeVersionMeta, Transcript, VersionedRecipe } from "@recipe/shared";
import { TERMINAL_STATUSES } from "@recipe/shared";
import { backend, type JobProgress } from "@/backend";
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
import { formatDuration } from "@/lib/format";
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
    transcriptFetchedRef.current = false;
    setJob(null);
    setLatest(null);
    setTranscript(null);
    setViewingVersion(null);
    setUnitSystem("original");
    setScaleFactor(1);
    setCheckedIngredients(new Set());
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
        }
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
        job.status === "done"
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
          <Stepper status={job.status} />
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
          {isProcessing && (
            <p className="text-xs text-[hsl(var(--ink-faint))]">
              Keep this tab open and in front — background tabs process more slowly.
            </p>
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
            {transcript ? (
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
        <>
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
            <>
              <div className="print-area space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2 max-w-[65ch]">
                    <h1 className="font-serif text-[34px] sm:text-[44px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
                      {displayedRecipe.title}
                    </h1>
                    {displayedRecipe.description && (
                      <p className="text-[hsl(var(--ink-muted))]">{displayedRecipe.description}</p>
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
                  <ServingsScaler
                    originalServings={displayedRecipe.servings}
                    factor={scaleFactor}
                    onFactorChange={setScaleFactor}
                  />
                  {displayedRecipe.totalTimeMinutes !== null && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] px-3 py-1 text-sm text-[hsl(var(--ink-muted))]">
                      <Clock className="h-3.5 w-3.5" /> {formatDuration(displayedRecipe.totalTimeMinutes)}
                    </span>
                  )}
                  <UnitsToggle value={unitSystem} onChange={setUnitSystem} />
                </div>
                {displayedRecipe.totalTimeMinutes !== null && (
                  <p className="hidden print:block text-sm text-[hsl(var(--ink-muted))]">
                    Total time: {formatDuration(displayedRecipe.totalTimeMinutes)}
                  </p>
                )}
              </div>

              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "recipe" | "transcript")}>
                <TabsList className="no-print">
                  <TabsTrigger value="recipe">Recipe</TabsTrigger>
                  <TabsTrigger value="transcript" disabled={!transcript}>
                    Transcript
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="recipe">
                  <RecipeView
                    recipe={displayedRecipe}
                    unitSystem={unitSystem}
                    scaleFactor={scaleFactor}
                    onSeek={seekTo}
                    currentTime={currentTime}
                    checkedIngredients={checkedIngredients}
                    onToggleIngredient={toggleIngredient}
                  />
                </TabsContent>
                <TabsContent value="transcript">
                  {transcript && (
                    <TranscriptView
                      transcript={transcript}
                      currentTime={currentTime}
                      onSeek={seekTo}
                    />
                  )}
                </TabsContent>
              </Tabs>
            </>
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

          <AudioPlayer
            ref={audioRef}
            jobId={jobId}
            title={job.title ?? job.fileName}
            activeStepText={activeStepText}
          />

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
        </>
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
