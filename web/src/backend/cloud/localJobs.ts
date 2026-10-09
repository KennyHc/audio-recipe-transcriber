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
  const map = read();
  if (!(jobId in map)) return;
  delete map[jobId];
  write(map);
}

export function clearLocalJobOwners(): void {
  write({});
}
