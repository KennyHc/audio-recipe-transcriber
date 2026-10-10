import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, EyeOff, KeyRound, Trash2, AlertTriangle, Sparkles, Download, Upload, Loader2 } from "lucide-react";
import { consumeSetupMessage } from "@/lib/needsSetup";
import { getBrowserSettings, saveBrowserSettings, maskApiKey } from "@/backend/settings";
import { BROWSER_DB_NAME } from "@/backend/constants";
import { deleteAllModelChunks } from "@/backend/browser/modelDownloader";
import { clearAll } from "@/lib/shopping";
import { closeDbConnection } from "@/backend/browser/db";
import { SPEECH_MODEL_CATALOG, speechModelKey } from "@/backend/browser/modelCatalog";
import { DEFAULT_BROWSER_SETTINGS } from "@/backend/types";
import { backend, shoppingList } from "@/backend";
import { IS_CLOUD, IS_HOSTED } from "@/lib/mode";
import { useAccountUser } from "@/lib/useAccount";
import { AccountSection } from "@/components/account/AccountSection";
import { formatMB } from "@/lib/downloadProgress";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

const EXTRACTOR_VERIFIER_OPTIONS = [
  { value: "claude-haiku-4-5", label: "Haiku 4.5 · ~1¢/recipe (default)" },
  { value: "claude-sonnet-5", label: "Sonnet 5 · ~3¢/recipe, strongest" },
];

// Real download sizes come from modelCatalog.ts (verified against the Hugging Face API — see
// its doc comment), not a stale estimate, and are shared by every mode.
const SPEECH_MODEL_OPTIONS = SPEECH_MODEL_CATALOG.map((o, i) => ({
  value: o.repoId,
  dtype: o.dtype,
  label: `${o.label} · ~${formatMB(o.downloadBytes)} download${i === 0 ? " (default)" : ""} — ${o.tradeoff}`,
}));

export function Settings() {
  const [settings, setSettings] = useState(() => getBrowserSettings());
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);

  const [includeAudio, setIncludeAudio] = useState(false);
  const [estimatedBackupBytes, setEstimatedBackupBytes] = useState<number | null>(null);
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const user = useAccountUser();
  // Cloud mode exports from the account (Firestore) under Account → "Download all my data";
  // the local backup section below is for the IndexedDB-only modes.
  const showLocalBackup = backend.canBackup && !IS_CLOUD;

  useEffect(() => {
    setSetupMessage(consumeSetupMessage());
  }, []);

  // Estimated backup size: the export itself is the only accurate way to know this (it
  // depends on every job's transcript/versions and, when checked, audio), so recompute it
  // whenever the "include audio" checkbox changes. Cheap for a typical local library.
  useEffect(() => {
    if (!showLocalBackup) return;
    let cancelled = false;
    backend
      .exportLibrary({ includeAudio })
      .then((blob) => {
        if (!cancelled) setEstimatedBackupBytes(blob.size);
      })
      .catch(() => {
        if (!cancelled) setEstimatedBackupBytes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [includeAudio]);

  async function handleDownloadBackup() {
    setDownloadingBackup(true);
    try {
      const blob = await backend.exportLibrary({ includeAudio });
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recipes-${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setRestoreError(null);
      setRestoreResult(null);
      setRestoreError(err instanceof Error ? err.message : "Couldn't create the backup file.");
    } finally {
      setDownloadingBackup(false);
    }
  }

  async function handleRestoreFile(file: File) {
    setRestoring(true);
    setRestoreResult(null);
    setRestoreError(null);
    try {
      const { imported, skipped } = await backend.importLibrary(file);
      const parts = [`Imported ${imported} recipe${imported === 1 ? "" : "s"}`];
      if (skipped > 0) parts.push(`skipped ${skipped} already here`);
      setRestoreResult(parts.join(", ") + ".");
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "Failed to restore backup.");
    } finally {
      setRestoring(false);
    }
  }

  function persist(next: typeof settings) {
    setSettings(next);
    saveBrowserSettings(next);
  }

  function handleSaveKey() {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    persist({ ...settings, apiKey: trimmed });
    setApiKeyInput("");
    setShowKey(false);
    setSavedNote("Key saved.");
    setTimeout(() => setSavedNote(null), 2500);
  }

  function handleRemoveKey() {
    persist({ ...settings, apiKey: null });
  }

  async function handleDeleteAllData() {
    setDeleting(true);
    try {
      // Close this page's own connection first, or the deletion waits on it.
      await closeDbConnection();
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(BROWSER_DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("Failed to delete local database"));
        req.onblocked = () => resolve(); // will complete once other connections close
      });
      if (typeof caches !== "undefined") {
        const names = await caches.keys();
        await Promise.all(
          names.filter((n) => n.toLowerCase().includes("transformers")).map((n) => caches.delete(n)),
        );
      }
      await deleteAllModelChunks().catch(() => undefined);
      // The shopping list lives in this browser too (cloud mode keeps it in the account instead).
      if (!IS_CLOUD) await shoppingList.update(() => clearAll()).catch(() => undefined);
      persist(DEFAULT_BROWSER_SETTINGS);
      setDeleteOpen(false);
    } catch {
      /* best-effort; nothing more we can do here */
    } finally {
      setDeleting(false);
    }
  }

  const currentSpeechKey = speechModelKey(settings.whisperModel, settings.whisperDtype);

  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 space-y-8">
      <a
        href="#/"
        className="inline-flex items-center gap-1 text-sm text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to library
      </a>

      <div className="space-y-1">
        <h1 className="font-serif text-[34px] sm:text-[40px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
          Settings
        </h1>
        <p className="text-sm text-[hsl(var(--ink-muted))]">
          {IS_CLOUD
            ? "Speech-to-text runs in your browser and your audio stays on this device. Recipes and transcripts are saved to your account."
            : IS_HOSTED
              ? "Speech-to-text runs in your browser; recipes are made by a free hosted service. Your audio, transcripts, and recipes stay on this device."
              : "Runs in your browser — your audio, transcripts, and recipes stay on this device."}
        </p>
      </div>

      {setupMessage && (
        <div className="flex items-start gap-2 rounded-[10px] border border-[hsl(var(--accent-tint-strong))] bg-[hsl(var(--accent-tint))] px-4 py-3 text-sm text-[hsl(var(--accent-text))]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{setupMessage}</span>
        </div>
      )}

      {IS_CLOUD && user && <AccountSection user={user} />}

      {!IS_HOSTED && !IS_CLOUD && (
        <section className="space-y-3 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 sm:p-6">
          <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">
            Anthropic API key
          </h2>
          <p className="text-sm text-[hsl(var(--ink-muted))]">
            The key is stored only in this browser and sent only to api.anthropic.com. Get one at{" "}
            <a
              href="https://console.anthropic.com"
              target="_blank"
              rel="noreferrer"
              className="text-[hsl(var(--accent-text))] underline underline-offset-2"
            >
              console.anthropic.com
            </a>{" "}
            — set a spend limit there.
          </p>

          {settings.apiKey && (
            <p className="flex items-center gap-2 text-sm text-[hsl(var(--ink))]">
              <KeyRound className="h-3.5 w-3.5 text-[hsl(var(--ink-faint))]" />
              Saved key: <span className="tabular-nums">{maskApiKey(settings.apiKey)}</span>
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                placeholder="sk-ant-…"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="pr-10"
                autoComplete="off"
              />
              <button
                type="button"
                aria-label={showKey ? "Hide key" : "Show key"}
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[hsl(var(--ink-faint))] hover:text-[hsl(var(--ink))]"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button onClick={handleSaveKey} disabled={!apiKeyInput.trim()}>
              Save
            </Button>
            {settings.apiKey && (
              <Button variant="outline" onClick={handleRemoveKey}>
                Remove key
              </Button>
            )}
          </div>
          {savedNote && <p className="text-sm text-[hsl(var(--accent-text))]">{savedNote}</p>}
        </section>
      )}

      <section className="space-y-4 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 sm:p-6">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">
          Models
        </h2>

        {IS_CLOUD ? (
          <div className="flex items-start gap-2 rounded-[10px] bg-[hsl(var(--sunken))] px-3.5 py-3 text-sm text-[hsl(var(--ink-muted))]">
            <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-[hsl(var(--ink-faint))]" />
            <div className="space-y-1">
              <p className="text-[hsl(var(--ink))]">Recipes are made by Claude on our server.</p>
              <p>Free: 30 recipes a month, re-extracts included.</p>
            </div>
          </div>
        ) : IS_HOSTED ? (
          <div className="flex items-start gap-2 rounded-[10px] bg-[hsl(var(--sunken))] px-3.5 py-3 text-sm text-[hsl(var(--ink-muted))]">
            <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-[hsl(var(--ink-faint))]" />
            <div className="space-y-1">
              <p className="text-[hsl(var(--ink))]">Recipes are made with Claude Haiku 4.5.</p>
              <p>Free: up to 20 recipes per day.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[hsl(var(--ink))]">Extractor</label>
              <Select
                value={settings.extractorModel}
                onValueChange={(v) => persist({ ...settings, extractorModel: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXTRACTOR_VERIFIER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[hsl(var(--ink))]">Verifier</label>
              <Select
                value={settings.verifierModel}
                onValueChange={(v) => persist({ ...settings, verifierModel: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXTRACTOR_VERIFIER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[hsl(var(--ink))]">Speech model</label>
          <Select
            value={currentSpeechKey}
            onValueChange={(v) => {
              const opt = SPEECH_MODEL_OPTIONS.find((o) => speechModelKey(o.value, o.dtype) === v);
              if (!opt) return;
              persist({ ...settings, whisperModel: opt.value, whisperDtype: opt.dtype });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEECH_MODEL_OPTIONS.map((o) => (
                <SelectItem key={speechModelKey(o.value, o.dtype)} value={speechModelKey(o.value, o.dtype)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-[hsl(var(--ink-faint))]">
            The first transcription downloads the speech model once; it's cached in this browser
            after that.
          </p>
        </div>
      </section>

      {showLocalBackup && (
        <section className="space-y-4 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 sm:p-6">
          <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">
            Your library
          </h2>
          <p className="text-sm text-[hsl(var(--ink-muted))]">
            Recipes live only in this browser — download a backup to keep them safe.
          </p>

          <div className="space-y-2.5">
            <label className="checkbox-row flex items-center gap-2.5 text-sm text-[hsl(var(--ink))]">
              <Checkbox
                checked={includeAudio}
                onChange={() => setIncludeAudio((v) => !v)}
                ariaLabel="Include audio in the backup"
              />
              Include audio (larger file)
            </label>
            <p className="text-xs text-[hsl(var(--ink-faint))]">
              {estimatedBackupBytes != null
                ? `Estimated size: ${estimatedBackupBytes < 1_000_000 ? "under 1 MB" : formatMB(estimatedBackupBytes)}`
                : "Estimating size…"}
            </p>
            <Button onClick={handleDownloadBackup} disabled={downloadingBackup}>
              {downloadingBackup ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Download backup
            </Button>
          </div>

          <div className="space-y-2.5 border-t border-[hsl(var(--border))] pt-4">
            <p className="text-sm font-medium text-[hsl(var(--ink))]">Restore from backup</p>
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleRestoreFile(file);
              }}
            />
            <Button
              variant="outline"
              onClick={() => restoreInputRef.current?.click()}
              disabled={restoring}
            >
              {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Choose backup file…
            </Button>
            {restoreResult && <p className="text-sm text-[hsl(var(--accent-text))]">{restoreResult}</p>}
            {restoreError && (
              <p role="alert" className="text-sm text-[hsl(var(--danger))]">
                {restoreError}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-[10px] border border-[hsl(var(--danger))]/30 bg-[hsl(var(--surface))] p-5 sm:p-6">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">
          {IS_CLOUD ? "This device" : "Danger zone"}
        </h2>
        <p className="text-sm text-[hsl(var(--ink-muted))]">
          {IS_CLOUD
            ? "Clears what's stored in this browser only: audio files, unfinished uploads, the downloaded speech model, and your settings here. Recipes in your account aren't affected, but click-to-hear stops working on this device."
            : "Permanently deletes every recipe, transcript, and audio file stored in this browser, plus the downloaded speech model and your saved settings. This can't be undone."}
        </p>
        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" /> {IS_CLOUD ? "Clear this device" : "Delete all local data"}
        </Button>
      </section>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{IS_CLOUD ? "Clear this device?" : "Delete all local data?"}</DialogTitle>
            <DialogDescription>
              {IS_CLOUD
                ? "This deletes the audio files, unfinished uploads, downloaded speech model, and settings stored in this browser. Your account and its recipes stay as they are."
                : "This permanently deletes every recipe, transcript, and audio file stored in this browser, the downloaded speech model, and your saved settings (including your API key). This can't be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDeleteAllData} disabled={deleting}>
              {deleting ? "Deleting…" : IS_CLOUD ? "Clear this device" : "Delete everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
