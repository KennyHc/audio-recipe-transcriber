export const BROWSER_DB_NAME = "recipe-transcriber";
export const SETTINGS_STORAGE_KEY = "recipe-transcriber:settings";

/** Separate IndexedDB database (not BROWSER_DB_NAME) that holds in-progress, chunked
 * downloads of speech-model files (see backend/browser/modelDownloader.ts). Kept apart
 * from the app's own data DB so "Delete all local data" and normal app data don't get
 * entangled with these large, purely-transient download chunks. */
export const MODEL_CHUNKS_DB_NAME = "recipe-transcriber-models";

/** Separate IndexedDB database for transcription checkpoints (finished ≤30 s windows of a clip
 * that is still transcribing — see backend/browser/checkpoints.ts). Separate so adding it needed
 * no schema upgrade of BROWSER_DB_NAME (which would block on other open tabs). Cleared when the
 * transcript is saved, when the job is deleted, and by "Delete all local data". */
export const CHECKPOINTS_DB_NAME = "recipe-transcriber-checkpoints";
