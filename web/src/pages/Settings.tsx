import { useEffect, useState } from "react";
import { ArrowLeft, Eye, EyeOff, KeyRound, Trash2, AlertTriangle } from "lucide-react";
import { consumeSetupMessage } from "@/lib/needsSetup";
import { getBrowserSettings, saveBrowserSettings, maskApiKey } from "@/backend/settings";
import { BROWSER_DB_NAME } from "@/backend/constants";
import { deleteAllModelChunks } from "@/backend/browser/modelDownloader";
import { DEFAULT_BROWSER_SETTINGS } from "@/backend/types";
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

const SPEECH_MODEL_OPTIONS = [
  {
    value: "onnx-community/whisper-large-v3-turbo",
    dtype: "q4",
    label: "Large v3 turbo (q4) · ~0.5–1 GB download, best (default)",
  },
  {
    value: "onnx-community/whisper-small",
    dtype: "q4",
    label: "Whisper small · smaller download, faster, less accurate",
  },
];

function speechModelKey(model: string, dtype: string) {
  return `${model}::${dtype}`;
}

export function Settings() {
  const [settings, setSettings] = useState(() => getBrowserSettings());
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);

  useEffect(() => {
    setSetupMessage(consumeSetupMessage());
  }, []);

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
          Runs in your browser — your audio, transcripts, and recipes stay on this device.
        </p>
      </div>

      {setupMessage && (
        <div className="flex items-start gap-2 rounded-[10px] border border-[hsl(var(--accent-tint-strong))] bg-[hsl(var(--accent-tint))] px-4 py-3 text-sm text-[hsl(var(--accent-text))]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{setupMessage}</span>
        </div>
      )}

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

      <section className="space-y-4 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 sm:p-6">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">
          Models
        </h2>

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

      <section className="space-y-3 rounded-[10px] border border-[hsl(var(--danger))]/30 bg-[hsl(var(--surface))] p-5 sm:p-6">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">
          Danger zone
        </h2>
        <p className="text-sm text-[hsl(var(--ink-muted))]">
          Permanently deletes every recipe, transcript, and audio file stored in this browser, plus
          the downloaded speech model and your saved settings. This can't be undone.
        </p>
        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" /> Delete all local data
        </Button>
      </section>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all local data?</DialogTitle>
            <DialogDescription>
              This permanently deletes every recipe, transcript, and audio file stored in this
              browser, the downloaded speech model, and your saved settings (including your API
              key). This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDeleteAllData} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
