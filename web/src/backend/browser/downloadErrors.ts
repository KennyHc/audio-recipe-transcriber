// Maps the raw, browser-specific errors a dropped connection produces mid fetch() (e.g. the
// laptop slept, Wi-Fi dropped) into one clear, actionable message. Transcription itself runs
// fully offline once the speech model is loaded (ONNX inference, no network), so any of these
// patterns surfacing from the whisper worker's pipeline() call are effectively guaranteed to
// come from the model-download fetch, not from inference.

const NETWORK_ERROR_PATTERNS = [
  /failed to fetch/i, // Chromium
  /networkerror/i, // Firefox: "NetworkError when attempting to fetch resource."
  /load failed/i, // Safari
  /network\s*error/i,
  /err_internet_disconnected/i,
  /err_network_changed/i,
  /err_connection/i,
  /the network connection was lost/i,
  /err_name_not_resolved/i,
];

export function isNetworkFailureMessage(message: string): boolean {
  return NETWORK_ERROR_PATTERNS.some((re) => re.test(message));
}

/**
 * Only says "kept" because it's true: transformers.js caches a model file only after it has
 * downloaded completely (see modelCatalog.ts's remainingBytesToDownload doc comment, and
 * node_modules/@huggingface/transformers/src/utils/hub.js's loadResourceFile, which reads the
 * full response into a buffer before calling storeCachedResource) — so a file that was still
 * in flight when the connection dropped is not cached, but any earlier file that finished is.
 */
export const MODEL_DOWNLOAD_INTERRUPTED_MESSAGE =
  "The speech model download was interrupted (connection lost). Press Retry — files that finished downloading are kept.";

/** Rewrites a raw error message from the transcription path into a clear one when it matches
 * a known network-failure signature; other errors are returned unchanged. */
export function describeTranscriptionError(message: string): string {
  return isNetworkFailureMessage(message) ? MODEL_DOWNLOAD_INTERRUPTED_MESSAGE : message;
}
