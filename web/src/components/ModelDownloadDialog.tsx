import { useEffect, useState } from "react";
import { Wifi } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { readDeviceFacts, recommendSpeechModel } from "@/lib/deviceProfile";
import { SPEECH_MODEL_CATALOG, speechModelKey, type SpeechModelOption } from "@/backend/browser/modelCatalog";
import { remainingBytesToDownload } from "@/backend/browser/modelDownloader";
import { formatMB } from "@/lib/downloadProgress";
import { readNetworkConnectionInfo, shouldRecommendWifi } from "@/lib/modelConsent";

export interface ModelDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The model+dtype pre-selected (usually the current setting, or the catalog default). */
  defaultOption?: SpeechModelOption;
  /** Called when the user presses Download; the caller saves the chosen model as the
   * setting and starts (or lets the queued job proceed with) the actual download. */
  onDownload: (option: SpeechModelOption) => void;
  /** Called when the user presses Cancel or dismisses the dialog without choosing. The
   * caller should leave the job paused ("Waiting for speech model — Download") rather than
   * erroring it. */
  onCancel: () => void;
}

/**
 * Shown before the first transcription when the chosen speech model isn't yet downloaded
 * in this browser (see modelCatalog.isModelCached / lib/modelConsent.shouldShowModelConsentDialog).
 * Lets the visitor see the download size up front, pick a model, and start — later clips
 * reuse the cached model and start immediately without asking again.
 */
export function ModelDownloadDialog({ open, onOpenChange, defaultOption, onDownload, onCancel }: ModelDownloadDialogProps) {
  const [selectedKey, setSelectedKey] = useState(
    () => speechModelKey((defaultOption ?? SPEECH_MODEL_CATALOG[0]!).repoId, (defaultOption ?? SPEECH_MODEL_CATALOG[0]!).dtype),
  );

  const wifiRecommended = shouldRecommendWifi(readNetworkConnectionInfo());
  // Why the smaller model is pre-selected on this device (phone, Data Saver, low memory, no GPU).
  const deviceReason = recommendSpeechModel(readDeviceFacts()).reason;
  const selected = SPEECH_MODEL_CATALOG.find((o) => speechModelKey(o.repoId, o.dtype) === selectedKey) ?? SPEECH_MODEL_CATALOG[0]!;

  // If a previous download was interrupted partway through, some of this model's files may
  // already be fully cached, and/or partially downloaded as chunks in modelDownloader's own
  // IndexedDB store (see modelDownloader.remainingBytesToDownload, which accounts for both).
  // Show what's actually left to fetch rather than the full size again, so a resumed download
  // doesn't look like it's starting over.
  const [remainingByKey, setRemainingByKey] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all(
      SPEECH_MODEL_CATALOG.map(async (o) => {
        const key = speechModelKey(o.repoId, o.dtype);
        const remaining = await remainingBytesToDownload(o.repoId, o.dtype);
        return [key, remaining] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setRemainingByKey(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleCancel() {
    onOpenChange(false);
    onCancel();
  }

  function handleDownload() {
    onOpenChange(false);
    onDownload(selected);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download the speech model (once)</DialogTitle>
          <DialogDescription>
            Transcription runs entirely in your browser, so it needs to download a speech model
            first. It's stored in this browser — later clips start immediately, no waiting.
          </DialogDescription>
        </DialogHeader>

        {deviceReason && selected.repoId.endsWith("whisper-small") && (
          <p className="text-xs text-[hsl(var(--ink-muted))]">{deviceReason} You can switch below.</p>
        )}

        <div role="radiogroup" aria-label="Speech model" className="space-y-2">
          {SPEECH_MODEL_CATALOG.map((o) => {
            const key = speechModelKey(o.repoId, o.dtype);
            const checked = key === selectedKey;
            const remaining = remainingByKey[key];
            const isResuming = remaining !== undefined && remaining > 0 && remaining < o.downloadBytes;
            return (
              <label
                key={key}
                className={
                  checked
                    ? "flex cursor-pointer items-start gap-3 rounded-[8px] border border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint))] p-3"
                    : "flex cursor-pointer items-start gap-3 rounded-[8px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 hover:border-[hsl(var(--border-strong))]"
                }
              >
                <input
                  type="radio"
                  name="speech-model"
                  value={key}
                  checked={checked}
                  onChange={() => setSelectedKey(key)}
                  className="mt-1 h-4 w-4 accent-[hsl(var(--accent-fill))]"
                />
                <span className="space-y-0.5">
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-[hsl(var(--ink))]">{o.label}</span>
                    <span className="text-xs tabular-nums text-[hsl(var(--ink-muted))]">
                      {isResuming ? `~${formatMB(remaining!)} left of ~${formatMB(o.downloadBytes)}` : `~${formatMB(o.downloadBytes)}`}
                    </span>
                  </span>
                  <span className="block text-xs text-[hsl(var(--ink-muted))]">{o.tradeoff}</span>
                  {isResuming && (
                    <span className="block text-xs text-[hsl(var(--accent-text))]">
                      Resuming — part of this model already finished downloading.
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        {wifiRecommended && (
          <p className="flex items-center gap-2 rounded-[8px] border border-[hsl(var(--accent-tint-strong))] bg-[hsl(var(--accent-tint))] px-3 py-2 text-xs text-[hsl(var(--accent-text))]">
            <Wifi className="h-3.5 w-3.5 shrink-0" /> Wi-Fi recommended — your connection looks slow or
            data-saving.
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleDownload}>Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
