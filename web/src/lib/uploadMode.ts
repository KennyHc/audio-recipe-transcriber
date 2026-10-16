// Which view the upload card opens in — "Audio clip" or "Captions / transcript" — remembered
// per browser (a convenience only; wrapped in try/catch, falls back to audio).

export type UploadMode = "audio" | "captions";

const KEY = "recipe-transcriber:upload-mode";

export function getPreferredUploadMode(): UploadMode {
  try {
    return localStorage.getItem(KEY) === "captions" ? "captions" : "audio";
  } catch {
    return "audio";
  }
}

export function setPreferredUploadMode(mode: UploadMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable */
  }
}
