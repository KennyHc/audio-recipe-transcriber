import { z } from "zod";

// Privacy-safe error reports from the browser (POST /client-errors on the Cloud Run API).
// Only codes and coarse device facts — never transcripts, recipe text, audio, emails, or
// URLs with ids. The client sanitizes `message` (shared rule below) before sending; the API
// re-applies it and logs one structured line (`{"event":"client_error", …}`) — nothing is
// stored in Firestore. Works signed out (App Check required); rate-limited per hashed IP.
//
//   POST /client-errors   ClientErrorReport -> 204

export const ClientErrorKind = z.enum([
  "pipeline", // a job failed (stage tells where)
  "model_download", // speech model download/caching failed
  "api", // an API call failed unexpectedly (5xx / network), not user-facing 4xx
  "uncaught", // window.onerror / unhandledrejection
]);
export type ClientErrorKind = z.infer<typeof ClientErrorKind>;

export const ClientErrorReport = z.object({
  kind: ClientErrorKind,
  stage: z.string().max(40).nullable(), // e.g. "transcribing", "extracting", "publish"
  code: z.string().max(60).nullable(), // e.g. CloudErrorCode, DOMException name
  message: z.string().max(300), // sanitized with sanitizeErrorMessage
  mode: z.enum(["server", "browser", "hosted", "cloud"]),
  appVersion: z.string().max(40), // build id
  device: z.object({
    userAgent: z.string().max(300),
    webgpu: z.boolean().nullable(),
    deviceMemoryGb: z.number().nullable(),
    mobile: z.boolean(),
  }),
});
export type ClientErrorReport = z.infer<typeof ClientErrorReport>;

export const MAX_CLIENT_ERRORS_PER_DAY = 50; // per hashed IP

const MEDIA_EXT = "mp3|m4a|mp4|m4v|wav|wave|ogg|oga|opus|webm|flac|aac|aiff?|caf|amr|3gp|mov|mkv|avi|wma|txt|json|pdf|md|csv|html?";

/**
 * Removes file names, URLs of any scheme (http, blob:, file:, data:, extension URLs), paths,
 * emails, every double-quoted snippet (JSON parse errors quote the payload), single-quoted text
 * with spaces, and long letter+digit tokens (Firestore / recipe ids). Run by the browser AND
 * again by the API — so the server never depends on the client having cleaned anything.
 */
export function scrubMessage(message: string): string {
  return message
    .replace(/\b(?:blob|file|data|chrome-extension|moz-extension|safari-web-extension|webkit-masked-url|wss?|ftp):\S*/gi, "<url>")
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>")
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@%+~-]+){2,}[\\/]?/g, "<path>")
    .replace(new RegExp(`[^\\s"'“”‘’/\\\\()<>]+\\.(?:${MEDIA_EXT})\\b`, "gi"), "<file>")
    .replace(/"[^"]*"/g, "<text>")
    .replace(/[“”][^“”]*[“”]/g, "<text>")
    .replace(/(['‘’])[^'‘’]*\s[^'‘’]*(['‘’])/g, "<text>")
    .replace(/\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{16,}\b/g, "<id>")
    .replace(/\b(?=[\w-]*\d)(?=[\w-]*[a-z])(?=[\w-]*[A-Z])[\w-]{8,}\b/g, (token) =>
      // Mixed-case letters + digits, 8+ chars, looks like a generated id ("aB3dE5fG9h"). Keep
      // familiar identifiers ("Float32Array", "Uint8Array") — they say which API failed.
      /^(?:[A-Z][a-z]+)+\d+(?:[A-Z][a-z]+)*$/.test(token) ? token : "<id>",
    );
}

/**
 * The full clean-up for a report message: scrubMessage, then the remaining catch-alls
 * (long quoted strings, UUIDs, digit runs), whitespace, and a length cap.
 */
export function sanitizeErrorMessage(message: string): string {
  return scrubMessage(message)
    .replace(/(["'“‘])[^"'”’]{12,}(["'”’])/g, "<text>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>")
    .replace(/\d{6,}/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * For the short label fields (stage, code): they come from our own code — status names, error
 * names, route templates like "POST /recipes/:id/publish" — so paths are kept, but anything
 * that could still identify someone (links, emails, ids, long numbers) is removed.
 */
export function sanitizeLabel(value: string): string {
  return value
    .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, "<url>")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>")
    .replace(/\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{16,}\b/g, "<id>")
    .replace(/\d{6,}/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

