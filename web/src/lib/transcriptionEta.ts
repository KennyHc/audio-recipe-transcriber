// "Keep this tab open — about N min left" while a clip transcribes in the browser.
//
// Before any audio is done we only have a prior: processing seconds per audio second for the
// chosen model on this device (small ≈ real time on phones; large ≈ 6× faster than real time
// with WebGPU). Once windows finish, the observed rate in this run takes over — blended with
// the prior while little has been measured, so one slow first window (model warm-up, shader
// compile) doesn't swing the estimate wildly.

/** Processing seconds per second of audio, before anything has been measured. */
export function priorSecondsPerAudioSecond(opts: { modelId: string; webgpu: boolean }): number {
  const small = /small|base|tiny/i.test(opts.modelId);
  if (small) return opts.webgpu ? 0.35 : 1;
  return opts.webgpu ? 1 / 6 : 2;
}

export interface EtaInput {
  totalAudioSeconds: number;
  /** Audio seconds finished (including any resumed from a checkpoint). */
  doneAudioSeconds: number;
  /** Audio seconds transcribed in THIS run (excludes the resumed part), and how long they took. */
  measuredAudioSeconds: number;
  measuredMs: number;
  prior: number;
}

/** Seconds of processing left, or null when unknown. */
export function estimateSecondsLeft(input: EtaInput): number | null {
  const remaining = Math.max(0, input.totalAudioSeconds - input.doneAudioSeconds);
  if (!Number.isFinite(remaining) || input.totalAudioSeconds <= 0) return null;
  if (remaining === 0) return 0;
  let rate = input.prior;
  if (input.measuredAudioSeconds > 0 && input.measuredMs > 0) {
    const observed = input.measuredMs / 1000 / input.measuredAudioSeconds;
    // Full trust after ~2 minutes of audio measured; linear blend before that.
    const weight = Math.min(1, input.measuredAudioSeconds / 120);
    rate = weight * observed + (1 - weight) * input.prior;
  }
  return remaining * rate;
}

/** "Keep this tab open — about 4 min left" (rounded up; "less than a minute" under 60 s). */
export function formatTimeLeft(secondsLeft: number | null): string {
  if (secondsLeft === null) return "Keep this tab open until it's done.";
  if (secondsLeft < 60) return "Keep this tab open — less than a minute left";
  const minutes = Math.ceil(secondsLeft / 60);
  return `Keep this tab open — about ${minutes} min left`;
}
