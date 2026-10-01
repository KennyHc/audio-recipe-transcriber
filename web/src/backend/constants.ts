export const BROWSER_DB_NAME = "recipe-transcriber";
export const SETTINGS_STORAGE_KEY = "recipe-transcriber:settings";

/** Separate IndexedDB database (not BROWSER_DB_NAME) that holds in-progress, chunked
 * downloads of speech-model files (see backend/browser/modelDownloader.ts). Kept apart
 * from the app's own data DB so "Delete all local data" and normal app data don't get
 * entangled with these large, purely-transient download chunks. */
export const MODEL_CHUNKS_DB_NAME = "recipe-transcriber-models";
