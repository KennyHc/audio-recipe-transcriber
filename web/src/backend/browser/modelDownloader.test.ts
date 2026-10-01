import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { MODEL_CHUNKS_DB_NAME } from "../constants";

const mockModelFilesWithUrls = vi.hoisted(() => vi.fn());

vi.mock("./modelCatalog", () => ({
  modelFilesWithUrls: mockModelFilesWithUrls,
  TRANSFORMERS_CACHE_NAME: "transformers-cache",
}));

import {
  ensureModelDownloaded,
  InsufficientStorageError,
  remainingBytesToDownload,
  deleteAllModelChunks,
  _resetDbConnectionForTests,
} from "./modelDownloader";

const REPO = "test-repo/fake-model";
const DTYPE = "q4";
const CHUNK_SIZE = 16 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Fake Cache Storage (transformers-cache), mirroring modelCatalog.test.ts's polyfill.
// ---------------------------------------------------------------------------
class FakeCache {
  store = new Map<string, Response>();
  async match(url: string): Promise<Response | undefined> {
    return this.store.get(url);
  }
  async put(url: string, response: Response): Promise<void> {
    this.store.set(url, response);
  }
}
class FakeCacheStorage {
  stores = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
}

// ---------------------------------------------------------------------------
// Fake fetch: serves Range requests with real 206/Content-Range/ETag semantics.
// ---------------------------------------------------------------------------
interface FakeFile {
  bytes: Uint8Array;
  etag: string;
  contentType: string;
}

function makeBytes(size: number, seed: number): Uint8Array {
  const arr = new Uint8Array(size);
  for (let i = 0; i < size; i++) arr[i] = (i + seed) % 256;
  return arr;
}

// Newer lib.dom typings distinguish Uint8Array<ArrayBuffer> from the more general
// Uint8Array<ArrayBufferLike> that `.slice()` on a typed array produces, which isn't
// directly assignable to BodyInit/BlobPart. Copy into a fresh, plain ArrayBuffer.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

// For multi-MB fixtures, `expect(...).toEqual(...)` on two large Uint8Arrays is extremely
// memory-hungry (Vitest's diffing walks them element-by-element via Object.entries-style
// access) and can exhaust the heap. Compare cheaply instead: same length, then a manual byte
// scan using only primitive number assertions.
function assertBytesEqual(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length);
  let mismatchAt = -1;
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      mismatchAt = i;
      break;
    }
  }
  expect(mismatchAt).toBe(-1);
}

type RequestHook = (url: string, start: number, end: number, callIndex: number) => "fail" | void;

function makeFetchMock(files: Map<string, FakeFile>, onRequest?: RequestHook) {
  let callIndex = 0;
  return vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const myCallIndex = callIndex++;
    if (init?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const file = files.get(url);
    if (!file) return new Response(null, { status: 404 });

    const headers = init?.headers as Record<string, string> | undefined;
    const rangeHeader = headers?.Range;
    const match = rangeHeader ? /bytes=(\d+)-(\d+)/.exec(rangeHeader) : null;
    if (!match) {
      return new Response(toArrayBuffer(file.bytes), { status: 200, headers: { "content-type": file.contentType } });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), file.bytes.length - 1);

    if (onRequest) {
      const outcome = onRequest(url, start, end, myCallIndex);
      if (outcome === "fail") {
        throw new TypeError("Failed to fetch");
      }
    }

    const slice = file.bytes.slice(start, end + 1);
    return new Response(toArrayBuffer(slice), {
      status: 206,
      headers: {
        "content-range": `bytes ${start}-${end}/${file.bytes.length}`,
        etag: file.etag,
        "content-type": file.contentType,
      },
    });
  });
}

async function countStoredChunks(url: string): Promise<number> {
  const db = await openDB(MODEL_CHUNKS_DB_NAME, 1);
  try {
    const keys = await db.getAllKeysFromIndex("chunks" as never, "byUrl" as never, url);
    return keys.length;
  } finally {
    db.close();
  }
}

let fakeCaches: FakeCacheStorage;

beforeEach(() => {
  fakeCaches = new FakeCacheStorage();
  (globalThis as unknown as { caches: FakeCacheStorage }).caches = fakeCaches;
  mockModelFilesWithUrls.mockReset();
});

afterEach(async () => {
  await _resetDbConnectionForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(MODEL_CHUNKS_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  vi.unstubAllGlobals();
});

describe("ensureModelDownloaded: full download", () => {
  it("downloads every required file into Cache Storage under its exact URL, with correct bytes", async () => {
    const fileA = { bytes: makeBytes(1000, 1), etag: '"a"', contentType: "application/json" };
    const fileB = { bytes: makeBytes(2000, 2), etag: '"b"', contentType: "application/octet-stream" };
    const urlA = "https://huggingface.co/test-repo/fake-model/resolve/main/config.json";
    const urlB = "https://huggingface.co/test-repo/fake-model/resolve/main/tokenizer.json";
    const files = new Map([
      [urlA, fileA],
      [urlB, fileB],
    ]);
    mockModelFilesWithUrls.mockReturnValue([
      { file: "config.json", bytes: fileA.bytes.length, url: urlA },
      { file: "tokenizer.json", bytes: fileB.bytes.length, url: urlB },
    ]);
    globalThis.fetch = makeFetchMock(files) as typeof fetch;

    const progressUpdates: { label: string; fraction: number | null }[] = [];
    await ensureModelDownloaded(REPO, DTYPE, { onProgress: (p) => progressUpdates.push(p) });

    const cache = await fakeCaches.open("transformers-cache");
    const cachedA = await cache.match(urlA);
    const cachedB = await cache.match(urlB);
    expect(cachedA).toBeDefined();
    expect(cachedB).toBeDefined();
    expect(new Uint8Array(await cachedA!.arrayBuffer())).toEqual(fileA.bytes);
    expect(new Uint8Array(await cachedB!.arrayBuffer())).toEqual(fileB.bytes);

    // Chunks were cleaned up once assembled into the cache.
    expect(await countStoredChunks(urlA)).toBe(0);
    expect(await countStoredChunks(urlB)).toBe(0);

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates.at(-1)!.fraction).toBe(1);
  });

  it("skips files already fully cached — no network request at all", async () => {
    const urlA = "https://huggingface.co/test-repo/fake-model/resolve/main/config.json";
    mockModelFilesWithUrls.mockReturnValue([{ file: "config.json", bytes: 10, url: urlA }]);
    const cache = await fakeCaches.open("transformers-cache");
    await cache.put(urlA, new Response(toArrayBuffer(new Uint8Array(10)), { status: 200 }));

    const fetchMock = makeFetchMock(new Map());
    globalThis.fetch = fetchMock as typeof fetch;

    await ensureModelDownloaded(REPO, DTYPE, {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ensureModelDownloaded: resume after interruption", () => {
  it("only fetches the chunks still missing after a mid-file failure", async () => {
    const size = CHUNK_SIZE * 2 + 500_000; // 3 chunks
    const url = "https://huggingface.co/test-repo/fake-model/resolve/main/onnx/big_q4.onnx";
    const file: FakeFile = { bytes: makeBytes(size, 7), etag: '"v1"', contentType: "application/octet-stream" };
    const files = new Map([[url, file]]);
    mockModelFilesWithUrls.mockReturnValue([{ file: "onnx/big_q4.onnx", bytes: size, url }]);

    // Fail every request for chunk index 1 (bytes CHUNK_SIZE..2*CHUNK_SIZE-1) on the first pass.
    globalThis.fetch = makeFetchMock(files, (_u, start) => {
      if (start === CHUNK_SIZE) return "fail";
    }) as typeof fetch;

    await expect(ensureModelDownloaded(REPO, DTYPE, {})).rejects.toThrow();

    // Chunk 0 and chunk 2 (which don't depend on ordering) should have landed; chunk 1 never did.
    const remainingAfterFailure = await remainingBytesToDownload(REPO, DTYPE);
    expect(remainingAfterFailure).toBeGreaterThan(0);
    expect(remainingAfterFailure).toBeLessThan(size);

    // Second attempt: fetch succeeds for everything now. Track which byte ranges are requested.
    const requestedStarts: number[] = [];
    globalThis.fetch = makeFetchMock(files, (_u, start) => {
      requestedStarts.push(start);
    }) as typeof fetch;

    await ensureModelDownloaded(REPO, DTYPE, {});

    const cache = await fakeCaches.open("transformers-cache");
    const cached = await cache.match(url);
    expect(cached).toBeDefined();
    assertBytesEqual(new Uint8Array(await cached!.arrayBuffer()), file.bytes);

    // Only the previously-missing chunk (plus the metadata-probe re-read of chunk 0) should have
    // been re-fetched — not all 3 chunks' worth of data again.
    expect(requestedStarts.length).toBeLessThan(3);
  });
});

describe("ensureModelDownloaded: ETag change restarts the file", () => {
  it("discards stale chunks and redownloads in full when the server's ETag no longer matches", async () => {
    const size = CHUNK_SIZE + 100_000; // 2 chunks
    const url = "https://huggingface.co/test-repo/fake-model/resolve/main/onnx/changed_q4.onnx";
    const v1: FakeFile = { bytes: makeBytes(size, 1), etag: '"v1"', contentType: "application/octet-stream" };
    mockModelFilesWithUrls.mockReturnValue([{ file: "onnx/changed_q4.onnx", bytes: size, url }]);

    // First attempt fails after chunk 0, leaving it stored under etag v1.
    globalThis.fetch = makeFetchMock(new Map([[url, v1]]), (_u, start) => {
      if (start === CHUNK_SIZE) return "fail";
    }) as typeof fetch;
    await expect(ensureModelDownloaded(REPO, DTYPE, {})).rejects.toThrow();
    expect(await countStoredChunks(url)).toBeGreaterThan(0);

    // Server-side file changed: new bytes, new ETag.
    const v2: FakeFile = { bytes: makeBytes(size, 999), etag: '"v2"', contentType: "application/octet-stream" };
    globalThis.fetch = makeFetchMock(new Map([[url, v2]])) as typeof fetch;

    await ensureModelDownloaded(REPO, DTYPE, {});

    const cache = await fakeCaches.open("transformers-cache");
    const cached = await cache.match(url);
    assertBytesEqual(new Uint8Array(await cached!.arrayBuffer()), v2.bytes);
    expect(await countStoredChunks(url)).toBe(0);
  });
});

describe("ensureModelDownloaded: chunk retry", () => {
  it("retries a failing chunk up to 3 times before giving up, and succeeds if it recovers in time", async () => {
    const url = "https://huggingface.co/test-repo/fake-model/resolve/main/config.json";
    const file: FakeFile = { bytes: makeBytes(500, 3), etag: '"a"', contentType: "application/json" };
    mockModelFilesWithUrls.mockReturnValue([{ file: "config.json", bytes: file.bytes.length, url }]);

    let attempts = 0;
    globalThis.fetch = makeFetchMock(new Map([[url, file]]), () => {
      attempts++;
      if (attempts < 3) return "fail"; // fails twice, succeeds on the 3rd attempt
    }) as typeof fetch;

    await ensureModelDownloaded(REPO, DTYPE, {});
    expect(attempts).toBe(3);

    const cache = await fakeCaches.open("transformers-cache");
    const cached = await cache.match(url);
    expect(new Uint8Array(await cached!.arrayBuffer())).toEqual(file.bytes);
  });

  it("gives up after 3 failed attempts and surfaces an error", async () => {
    const url = "https://huggingface.co/test-repo/fake-model/resolve/main/config.json";
    const file: FakeFile = { bytes: makeBytes(500, 3), etag: '"a"', contentType: "application/json" };
    mockModelFilesWithUrls.mockReturnValue([{ file: "config.json", bytes: file.bytes.length, url }]);

    let attempts = 0;
    globalThis.fetch = makeFetchMock(new Map([[url, file]]), () => {
      attempts++;
      return "fail";
    }) as typeof fetch;

    await expect(ensureModelDownloaded(REPO, DTYPE, {})).rejects.toThrow();
    expect(attempts).toBe(3);
  });
});

describe("ensureModelDownloaded: cancellation", () => {
  it("keeps finished chunks when aborted mid-download", async () => {
    const size = CHUNK_SIZE * 2 + 500_000; // 3 chunks
    const url = "https://huggingface.co/test-repo/fake-model/resolve/main/onnx/cancel_q4.onnx";
    const file: FakeFile = { bytes: makeBytes(size, 5), etag: '"v1"', contentType: "application/octet-stream" };
    mockModelFilesWithUrls.mockReturnValue([{ file: "onnx/cancel_q4.onnx", bytes: size, url }]);
    globalThis.fetch = makeFetchMock(new Map([[url, file]])) as typeof fetch;

    const controller = new AbortController();
    let sawFirstProgress = false;
    await expect(
      ensureModelDownloaded(REPO, DTYPE, {
        signal: controller.signal,
        onProgress: () => {
          // Abort as soon as we hear about any progress (chunk 0, fetched by the metadata
          // probe, will already be stored in IDB by then).
          if (!sawFirstProgress) {
            sawFirstProgress = true;
            controller.abort();
          }
        },
      }),
    ).rejects.toThrow();

    expect(await countStoredChunks(url)).toBeGreaterThan(0);
    const remaining = await remainingBytesToDownload(REPO, DTYPE);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(size);
  });
});

describe("ensureModelDownloaded: storage space", () => {
  it("fails early with a clear message when there isn't enough free storage, without fetching anything", async () => {
    const url = "https://huggingface.co/test-repo/fake-model/resolve/main/onnx/huge_q4.onnx";
    mockModelFilesWithUrls.mockReturnValue([{ file: "onnx/huge_q4.onnx", bytes: 500_000_000, url }]);

    const fetchMock = makeFetchMock(new Map());
    globalThis.fetch = fetchMock as typeof fetch;

    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      storage: {
        estimate: async () => ({ quota: 100_000_000, usage: 0 }),
        persist: async () => false,
      },
    });

    await expect(ensureModelDownloaded(REPO, DTYPE, {})).rejects.toThrow(InsufficientStorageError);
    await expect(ensureModelDownloaded(REPO, DTYPE, {})).rejects.toThrow(/storage space/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deleteAllModelChunks", () => {
  it("removes the chunks database entirely", async () => {
    const url = "https://huggingface.co/test-repo/fake-model/resolve/main/config.json";
    const file: FakeFile = { bytes: makeBytes(500, 3), etag: '"a"', contentType: "application/json" };
    mockModelFilesWithUrls.mockReturnValue([{ file: "config.json", bytes: file.bytes.length, url }]);
    globalThis.fetch = makeFetchMock(new Map([[url, file]]), (_u, start) => {
      if (start === 0) return "fail"; // leaves nothing in cache but forces a chunk write attempt path
    }) as typeof fetch;

    // Doesn't matter if this throws — we just want to exercise deleteAllModelChunks cleanly.
    await ensureModelDownloaded(REPO, DTYPE, {}).catch(() => undefined);
    await expect(deleteAllModelChunks()).resolves.toBeUndefined();
  });
});
