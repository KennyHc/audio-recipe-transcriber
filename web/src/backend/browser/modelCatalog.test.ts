import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SPEECH_MODEL,
  SPEECH_MODEL_CATALOG,
  TRANSFORMERS_CACHE_NAME,
  findSpeechModelOption,
  isModelCached,
  modelFiles,
  remainingBytesToDownload,
  requiredModelFileUrls,
  speechModelKey,
} from "./modelCatalog";

describe("modelCatalog", () => {
  it("has exactly two options, large-v3-turbo default and small, no base model", () => {
    expect(SPEECH_MODEL_CATALOG).toHaveLength(2);
    expect(SPEECH_MODEL_CATALOG.some((o) => /base/i.test(o.repoId))).toBe(false);
    expect(DEFAULT_SPEECH_MODEL.repoId).toBe("onnx-community/whisper-large-v3-turbo");
  });

  it("gives every option a positive download size and a non-empty trade-off line", () => {
    for (const o of SPEECH_MODEL_CATALOG) {
      expect(o.downloadBytes).toBeGreaterThan(0);
      expect(o.tradeoff.length).toBeGreaterThan(0);
    }
  });

  it("large-v3-turbo download is bigger than small's", () => {
    const turbo = SPEECH_MODEL_CATALOG.find((o) => o.repoId.includes("large-v3-turbo"));
    const small = SPEECH_MODEL_CATALOG.find((o) => o.repoId.includes("whisper-small"));
    expect(turbo).toBeDefined();
    expect(small).toBeDefined();
    expect(turbo!.downloadBytes).toBeGreaterThan(small!.downloadBytes);
  });

  it("downloadBytes falls within the ~0.5-1GB / smaller-download bands described to users", () => {
    const turbo = findSpeechModelOption("onnx-community/whisper-large-v3-turbo", "q4")!;
    const small = findSpeechModelOption("onnx-community/whisper-small", "q4")!;
    expect(turbo.downloadBytes).toBeGreaterThan(500_000_000);
    expect(turbo.downloadBytes).toBeLessThan(1_000_000_000);
    expect(small.downloadBytes).toBeLessThan(400_000_000);
  });

  it("speechModelKey round-trips into a stable, unique key per (repo, dtype)", () => {
    expect(speechModelKey("a/b", "q4")).toBe("a/b::q4");
    expect(speechModelKey("a/b", "q4")).not.toBe(speechModelKey("a/b", "q8"));
  });

  it("modelFiles' bytes sum to the catalog's downloadBytes for each option", () => {
    for (const o of SPEECH_MODEL_CATALOG) {
      const files = modelFiles(o.repoId, o.dtype);
      expect(files.length).toBeGreaterThan(0);
      const sum = files.reduce((a, f) => a + f.bytes, 0);
      expect(sum).toBe(o.downloadBytes);
    }
  });

  it("modelFiles is empty for a model not in the catalog", () => {
    expect(modelFiles("not/a-model", "q4")).toEqual([]);
  });

  it("requiredModelFileUrls includes both onnx sessions with the dtype suffix and the aux files", () => {
    const urls = requiredModelFileUrls("onnx-community/whisper-large-v3-turbo", "q4");
    expect(urls).toContain(
      "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/encoder_model_q4.onnx",
    );
    expect(urls).toContain(
      "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/decoder_model_merged_q4.onnx",
    );
    expect(urls).toContain(
      "https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/tokenizer.json",
    );
    expect(urls.length).toBeGreaterThanOrEqual(7);
  });

  it("findSpeechModelOption returns undefined for an unlisted model", () => {
    expect(findSpeechModelOption("not/a-model", "q4")).toBeUndefined();
  });
});

// The test environment (Node, not a browser) has no Cache Storage API. Install a minimal
// in-memory polyfill so isModelCached/remainingBytesToDownload can be exercised against a
// real `caches.open(...).match(...)`/`.put(...)` round-trip rather than mocking the module.
class FakeCache {
  private store = new Map<string, Response>();
  async match(url: string): Promise<Response | undefined> {
    return this.store.get(url);
  }
  async put(url: string, response: Response): Promise<void> {
    this.store.set(url, response);
  }
}
class FakeCacheStorage {
  private stores = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
}

describe("isModelCached / remainingBytesToDownload", () => {
  beforeAll(() => {
    (globalThis as unknown as { caches: FakeCacheStorage }).caches = new FakeCacheStorage();
  });

  afterEach(async () => {
    await caches.delete(TRANSFORMERS_CACHE_NAME);
  });

  it("is false, with the full size remaining, when nothing is cached", async () => {
    expect(await isModelCached("onnx-community/whisper-small", "q4")).toBe(false);
    const remaining = await remainingBytesToDownload("onnx-community/whisper-small", "q4");
    const full = findSpeechModelOption("onnx-community/whisper-small", "q4")!.downloadBytes;
    expect(remaining).toBe(full);
  });

  it("is false for a model not in the catalog", async () => {
    expect(await isModelCached("not/a-model", "q4")).toBe(false);
  });

  it("is true once every required file is in Cache Storage, with 0 bytes remaining", async () => {
    const repoId = "onnx-community/whisper-small";
    const dtype = "q4";
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    for (const url of requiredModelFileUrls(repoId, dtype)) {
      await cache.put(url, new Response("x"));
    }
    expect(await isModelCached(repoId, dtype)).toBe(true);
    expect(await remainingBytesToDownload(repoId, dtype)).toBe(0);
  });

  it("reports partial remaining bytes when only some files finished downloading (an interrupted download)", async () => {
    const repoId = "onnx-community/whisper-small";
    const dtype = "q4";
    const files = modelFiles(repoId, dtype);
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    // Only the small aux files "finished" — the big encoder/decoder onnx files did not.
    const finished = files.filter((f) => !f.file.endsWith(".onnx"));
    for (const f of finished) {
      await cache.put(
        `https://huggingface.co/${repoId}/resolve/main/${f.file}`,
        new Response("x"),
      );
    }
    expect(await isModelCached(repoId, dtype)).toBe(false);
    const remaining = await remainingBytesToDownload(repoId, dtype);
    const expectedRemaining = files.filter((f) => f.file.endsWith(".onnx")).reduce((a, f) => a + f.bytes, 0);
    expect(remaining).toBe(expectedRemaining);
    expect(remaining).toBeLessThan(findSpeechModelOption(repoId, dtype)!.downloadBytes);
  });
});
