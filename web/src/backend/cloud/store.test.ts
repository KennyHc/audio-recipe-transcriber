import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase/firestore";
import { cloudRecipe, recipe, transcript, versioned } from "./testFixtures";

// firebase/firestore is replaced by a tiny fake that records paths and writes, so these tests
// pin down the exact shapes the store sends — the ones firebase/test/rules.test.ts proves the
// rules accept (one atomic write for version n+1 + recipe fields; children-then-recipe delete).

type Ref = { path: string; id: string };
const docs = new Map<string, unknown>();
const writes: Array<{ op: string; path: string; data?: unknown }> = [];
const commits: Array<Array<{ op: string; path: string }>> = [];
const queries: unknown[] = [];
let snapshotCallback: ((snap: unknown) => void) | null = null;

function denied() {
  return Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
}

vi.mock("firebase/firestore", () => {
  const ref = (path: string): Ref => ({ path, id: path.split("/").pop()! });
  const snap = (path: string) => ({
    exists: () => docs.has(path),
    data: () => docs.get(path),
    id: path.split("/").pop(),
    ref: ref(path),
  });
  return {
    doc: (base: unknown, ...segments: string[]) => {
      const prefix = typeof base === "object" && base && "path" in base ? (base as Ref).path : "";
      return ref([prefix, ...segments].filter(Boolean).join("/"));
    },
    collection: (_db: unknown, ...segments: string[]) => ref(segments.join("/")),
    query: (...parts: unknown[]) => {
      queries.push(parts);
      return parts[0];
    },
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    orderBy: (field: string, dir: string) => ({ orderBy: [field, dir] }),
    onSnapshot: (_q: unknown, _options: unknown, next: (s: unknown) => void) => {
      // Snapshots without metadata count as server snapshots.
      snapshotCallback = (s) => next({ metadata: { fromCache: false }, ...(s as object) });
      return () => undefined;
    },
    getDoc: async (r: Ref) => {
      if (!docs.has(r.path) && r.path.startsWith("recipes/") && !docs.has(r.path.split("/").slice(0, 2).join("/"))) throw denied();
      return snap(r.path);
    },
    getDocs: async (c: Ref) => {
      if (!docs.has(c.path.split("/").slice(0, 2).join("/"))) throw denied();
      const children = [...docs.keys()].filter((k) => k.startsWith(`${c.path}/`) && k.split("/").length === c.path.split("/").length + 1);
      return { docs: children.map(snap) };
    },
    setDoc: async (r: Ref, data: unknown) => {
      writes.push({ op: "set", path: r.path, data });
    },
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: async (r: Ref) => snap(r.path),
        set: (r: Ref, data: unknown) => writes.push({ op: "tx.set", path: r.path, data }),
        update: (r: Ref, data: unknown) => writes.push({ op: "tx.update", path: r.path, data }),
      };
      return fn(tx);
    },
    writeBatch: () => {
      const ops: Array<{ op: string; path: string }> = [];
      return {
        delete: (r: Ref) => ops.push({ op: "delete", path: r.path }),
        commit: async () => void commits.push(ops),
      };
    },
  };
});

const { createRecipeStore } = await import("./store");

beforeEach(() => {
  docs.clear();
  writes.length = 0;
  commits.length = 0;
  queries.length = 0;
  snapshotCallback = null;
});

const fakeDb = {} as Firestore;

describe("RecipeStore", () => {
  it("lists with the ownerId filter the rules require, newest first, from a live query", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = createRecipeStore(fakeDb);
    const pending = store.listRecipes("alice");
    const a = cloudRecipe("a", "A", "2026-10-01T00:00:00Z");
    const b = cloudRecipe("b", "B", "2026-10-05T00:00:00Z");
    snapshotCallback!({
      docs: [b, a].map(({ id, ...data }) => ({ id, data: () => data })).concat([{ id: "bad", data: () => ({ nope: 1 }) } as never]),
    });
    expect((await pending).map((r) => r.id)).toEqual(["b", "a"]);
    const [collectionRef, ...constraints] = queries[0] as [Ref, ...unknown[]];
    expect(collectionRef.path).toBe("recipes");
    expect(constraints).toEqual([{ where: ["ownerId", "==", "alice"] }, { orderBy: ["updatedAt", "desc"] }]);
    expect(warn).toHaveBeenCalledTimes(1); // the malformed doc is skipped, not fatal
  });

  it("waits for the server's snapshot, not a partial one from the local cache", async () => {
    const store = createRecipeStore(fakeDb);
    let done = false;
    const pending = store.listRecipes("alice").then((list) => {
      done = true;
      return list;
    });
    const toDocs = (rs: ReturnType<typeof cloudRecipe>[]) => rs.map(({ id, ...data }) => ({ id, data: () => data }));
    const copy = cloudRecipe("copy", "Copy", "2026-10-06T00:00:00Z");
    const older = cloudRecipe("older", "Older", "2026-10-01T00:00:00Z");

    snapshotCallback!({ metadata: { fromCache: true }, docs: toDocs([copy]) });
    await Promise.resolve();
    expect(done).toBe(false);

    snapshotCallback!({ docs: toDocs([copy, older]) });
    expect((await pending).map((r) => r.id)).toEqual(["copy", "older"]);
  });

  it("saves an edit as version n+1 plus the recipe's denormalized fields in one transaction", async () => {
    const { id, ...data } = cloudRecipe("r1", "Soup", "2026-10-01T00:00:00Z", 2);
    docs.set(`recipes/${id}`, data);
    const store = createRecipeStore(fakeDb);
    const r = recipe("Better soup");

    const v = await store.saveClientVersion("r1", r, "edited", null);

    expect(v.meta).toMatchObject({ version: 3, source: "edited", note: null });
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ op: "tx.set", path: "recipes/r1/versions/3", data: { meta: v.meta, recipe: r } });
    expect(writes[1]!.op).toBe("tx.update");
    expect(writes[1]!.path).toBe("recipes/r1");
    expect(Object.keys(writes[1]!.data as object).sort()).toEqual(["currentVersion", "latest", "title", "updatedAt"]);
    expect(writes[1]!.data).toMatchObject({ currentVersion: 3, latest: r, title: "Better soup" });
  });

  it("a missing or foreign recipe reads as 'Recipe not found.'", async () => {
    const store = createRecipeStore(fakeDb);
    await expect(store.getRecipe("nope")).rejects.toThrow("Recipe not found.");
  });

  it("deletes versions and transcript, then the recipe, in one batch", async () => {
    docs.set("recipes/r1", {});
    docs.set("recipes/r1/versions/1", versioned(1, "A"));
    docs.set("recipes/r1/versions/2", versioned(2, "A", "edited"));
    const store = createRecipeStore(fakeDb);

    expect(await store.deleteRecipe("r1")).toBe(true);
    expect(commits).toEqual([
      [
        { op: "delete", path: "recipes/r1/versions/1" },
        { op: "delete", path: "recipes/r1/versions/2" },
        { op: "delete", path: "recipes/r1/private/transcript" },
        { op: "delete", path: "recipes/r1" },
      ],
    ]);
    expect(await store.deleteRecipe("not-mine")).toBe(false);
  });

  it("updates the transcript doc with exactly {transcript, updatedAt}", async () => {
    const store = createRecipeStore(fakeDb);
    await store.putTranscript("r1", transcript);
    expect(writes[0]!.path).toBe("recipes/r1/private/transcript");
    expect(Object.keys(writes[0]!.data as object).sort()).toEqual(["transcript", "updatedAt"]);
    expect(Object.keys((writes[0]!.data as { transcript: object }).transcript).sort()).toEqual(["language", "segments"]);
  });
});
