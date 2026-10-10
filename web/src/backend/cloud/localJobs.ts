// Cloud mode: which local (IndexedDB) jobs belong to which signed-in user.
//
// An upload in cloud mode is a local job until the API saves its recipe (then the local job is
// removed and only its audio stays). Those pending jobs share the IndexedDB database with the
// old anonymous/BYOK library (same origin, same DB name — browser/db.ts), so this small map
// tells them apart: a local job listed here is an in-flight upload of that uid; a local job not
// listed here is from the old local library and is offered for "Move into your account".
// Stored in localStorage, with an in-memory fallback when storage is unavailable.

const KEY = "recipe-transcriber:cloud-jobs";

let memory: Record<string, string> = {};

function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return memory;
  }
}

function write(map: Record<string, string>): void {
  memory = map;
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — the in-memory copy lasts for this page */
  }
}

export function markLocalJob(jobId: string, uid: string): void {
  write({ ...read(), [jobId]: uid });
}

export function localJobOwner(jobId: string): string | null {
  return read()[jobId] ?? null;
}

export function forgetLocalJob(jobId: string): void {
  forgetLocalJobSourceUrl(jobId);
  const map = read();
  if (!(jobId in map)) return;
  delete map[jobId];
  write(map);
}

export function clearLocalJobOwners(): void {
  write({});
  writeSources({});
}

// The video/page link entered at upload, kept with the pending local job until POST /recipes
// sends it (so a Retry after a failed POST still sends it).

const SOURCES_KEY = "recipe-transcriber:cloud-job-sources";
let sourcesMemory: Record<string, string> = {};

function readSources(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return sourcesMemory;
  }
}

function writeSources(map: Record<string, string>): void {
  sourcesMemory = map;
  try {
    localStorage.setItem(SOURCES_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — the in-memory copy lasts for this page */
  }
}

export function setLocalJobSourceUrl(jobId: string, sourceUrl: string): void {
  writeSources({ ...readSources(), [jobId]: sourceUrl });
}

export function localJobSourceUrl(jobId: string): string | null {
  const v = readSources()[jobId];
  return typeof v === "string" && v ? v : null;
}

function forgetLocalJobSourceUrl(jobId: string): void {
  const map = readSources();
  if (!(jobId in map)) return;
  delete map[jobId];
  writeSources(map);
}
