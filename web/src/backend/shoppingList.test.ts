import { describe, expect, it, vi } from "vitest";
import type { ShoppingListDoc } from "@recipe/shared";
import { addRecipeToList, emptyList, toggleItem } from "@/lib/shopping";
import { createLocalShoppingStore, SHOPPING_STORAGE_KEY, type KeyValueStorage, type ShoppingListState } from "./shoppingList";
import { createCloudShoppingStore, SIGN_IN_FOR_LIST_MESSAGE, type ShoppingDocIO } from "./cloud/shoppingList";

const NOW = new Date("2026-10-10T12:00:00.000Z");

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const addEggs = (list: ShoppingListDoc) =>
  addRecipeToList(
    list,
    {
      recipeId: "recipe0001",
      title: "Omelette",
      isPublic: false,
      scaleFactor: 1,
      ingredients: [{ quantity: 3, unit: null, item: "eggs", prep: null, sourceText: "", timestamp: null, confidence: "stated" }],
    },
    { now: NOW, makeId: () => "egg1" },
  );

function lastReady(states: ShoppingListState[]) {
  const s = states[states.length - 1];
  if (!s || s.status !== "ready") throw new Error(`not ready: ${JSON.stringify(s)}`);
  return s;
}

describe("createLocalShoppingStore", () => {
  it("starts empty, saves to localStorage and notifies subscribers", async () => {
    const storage = memoryStorage();
    const store = createLocalShoppingStore(storage);
    const states: ShoppingListState[] = [];
    store.subscribe((s) => states.push(s));
    expect(lastReady(states).list.items).toEqual([]);

    const result = await store.update(addEggs);
    expect(result!.added).toBe(1);
    expect(lastReady(states).list.items[0]!.item).toBe("eggs");
    expect(JSON.parse(storage.data[SHOPPING_STORAGE_KEY]!).items[0].quantity).toBe(3);
  });

  it("reads an existing list and drops malformed items", () => {
    const stored = addEggs(emptyList(NOW)).list;
    const storage = memoryStorage({
      [SHOPPING_STORAGE_KEY]: JSON.stringify({ ...stored, items: [...stored.items, { junk: true }] }),
    });
    const states: ShoppingListState[] = [];
    createLocalShoppingStore(storage).subscribe((s) => states.push(s));
    expect(lastReady(states).list.items.map((i) => i.id)).toEqual(["egg1"]);
  });

  it("starts fresh on unparsable JSON", () => {
    const states: ShoppingListState[] = [];
    createLocalShoppingStore(memoryStorage({ [SHOPPING_STORAGE_KEY]: "{not json" })).subscribe((s) => states.push(s));
    expect(lastReady(states).list.items).toEqual([]);
  });

  it("works in memory when storage throws, and says the list won't be kept", async () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const store = createLocalShoppingStore(throwing);
    const states: ShoppingListState[] = [];
    store.subscribe((s) => states.push(s));
    await store.update(addEggs);
    const ready = lastReady(states);
    expect(ready.list.items).toHaveLength(1);
    expect(ready.error).toMatch(/Couldn't save/);
  });

  it("works with no storage at all", async () => {
    const store = createLocalShoppingStore(null);
    await store.update(addEggs);
    const states: ShoppingListState[] = [];
    store.subscribe((s) => states.push(s));
    expect(lastReady(states).list.items).toHaveLength(1);
  });

  it("leaves the list alone when the update returns null", async () => {
    const storage = memoryStorage();
    const store = createLocalShoppingStore(storage);
    expect(await store.update(() => null)).toBeNull();
    expect(storage.data[SHOPPING_STORAGE_KEY]).toBeUndefined();
  });

  it("unsubscribes", async () => {
    const store = createLocalShoppingStore(memoryStorage());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();
    await store.update(addEggs);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

function fakeIO(initial: unknown | null = null) {
  let data: unknown | null = initial;
  const watchers = new Map<string, { next: (d: unknown | null) => void; error: (e: unknown) => void }>();
  const io: ShoppingDocIO & { writes: Array<{ uid: string; list: ShoppingListDoc }>; failNextWrite: unknown; unwatched: string[] } = {
    writes: [],
    failNextWrite: null,
    unwatched: [],
    watch: vi.fn((uid: string, next, error) => {
      watchers.set(uid, { next, error });
      next(data);
      return () => {
        watchers.delete(uid);
        io.unwatched.push(uid);
      };
    }),
    read: vi.fn(async () => data),
    write: vi.fn(async (uid: string, list: ShoppingListDoc) => {
      if (io.failNextWrite) {
        const err = io.failNextWrite;
        io.failNextWrite = null;
        throw err;
      }
      io.writes.push({ uid, list });
      data = list;
      watchers.get(uid)?.next(list);
    }),
  };
  return {
    io,
    emitError: (uid: string, err: unknown) => watchers.get(uid)?.error(err),
    watching: () => [...watchers.keys()],
  };
}

function fakeAuth(initial: string | null | undefined) {
  let listener: ((uid: string | null | undefined) => void) | null = null;
  return {
    subscribeUid: (l: (uid: string | null | undefined) => void) => {
      listener = l;
      l(initial);
      return () => undefined;
    },
    set: (uid: string | null | undefined) => listener?.(uid),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createCloudShoppingStore", () => {
  it("is loading while the session restores, then signed-out", () => {
    const auth = fakeAuth(undefined);
    const { io } = fakeIO();
    const store = createCloudShoppingStore({ subscribeUid: auth.subscribeUid, io });
    const states: ShoppingListState[] = [];
    store.subscribe((s) => states.push(s));
    expect(states[0]).toEqual({ status: "loading" });
    auth.set(null);
    expect(states[states.length - 1]).toEqual({ status: "signed-out" });
    expect(io.watch).not.toHaveBeenCalled();
  });

  it("rejects updates when signed out (prompt to sign in)", async () => {
    const store = createCloudShoppingStore({ subscribeUid: fakeAuth(null).subscribeUid, io: fakeIO().io });
    await expect(store.update(addEggs)).rejects.toThrow(SIGN_IN_FOR_LIST_MESSAGE);
  });

  it("waits for the session before updating", async () => {
    const auth = fakeAuth(undefined);
    const { io } = fakeIO();
    const store = createCloudShoppingStore({ subscribeUid: auth.subscribeUid, io });
    const pending = store.update(addEggs);
    auth.set("uid1");
    await expect(pending).resolves.toMatchObject({ added: 1 });
    expect(io.writes[0]!.uid).toBe("uid1");
  });

  it("watches users/{uid}/lists/shopping only while subscribed", () => {
    const { io, watching } = fakeIO();
    const store = createCloudShoppingStore({ subscribeUid: fakeAuth("uid1").subscribeUid, io });
    expect(watching()).toEqual([]);
    const states: ShoppingListState[] = [];
    const off = store.subscribe((s) => states.push(s));
    expect(watching()).toEqual(["uid1"]);
    expect(lastReady(states).list.items).toEqual([]); // no doc yet = empty list
    off();
    expect(watching()).toEqual([]);
  });

  it("writes the whole doc and shows the change right away", async () => {
    const { io } = fakeIO();
    const store = createCloudShoppingStore({ subscribeUid: fakeAuth("uid1").subscribeUid, io });
    const states: ShoppingListState[] = [];
    store.subscribe((s) => states.push(s));
    await store.update(addEggs);
    expect(lastReady(states).list.items[0]!.id).toBe("egg1");
    await flush();
    expect(io.writes).toHaveLength(1);
    expect(Object.keys(io.writes[0]!.list).sort()).toEqual(["items", "updatedAt"]);

    await store.update((l) => toggleItem(l, "egg1", NOW));
    await flush();
    expect(io.writes[1]!.list.items[0]!.checked).toBe(true);
  });

  it("reads the doc when not subscribed (e.g. Add from a recipe page)", async () => {
    const existing = addEggs(emptyList(NOW)).list;
    const { io } = fakeIO(existing);
    const store = createCloudShoppingStore({ subscribeUid: fakeAuth("uid1").subscribeUid, io });
    const result = await store.update(addEggs);
    expect(io.read).toHaveBeenCalledWith("uid1");
    expect(result!.merged).toBe(1);
    expect(result!.list.items[0]!.quantity).toBe(6);
  });

  it("surfaces a failed write as an error on the ready state", async () => {
    const { io } = fakeIO();
    io.failNextWrite = Object.assign(new Error("denied"), { code: "permission-denied" });
    const store = createCloudShoppingStore({ subscribeUid: fakeAuth("uid1").subscribeUid, io });
    const states: ShoppingListState[] = [];
    store.subscribe((s) => states.push(s));
    await store.update(addEggs);
    await flush();
    expect(lastReady(states).error).toMatch(/Couldn't save your list/);
  });

  it("shows a snapshot error", () => {
    const { io, emitError } = fakeIO();
    const store = createCloudShoppingStore({ subscribeUid: fakeAuth("uid1").subscribeUid, io });
    const states: ShoppingListState[] = [];
    store.subscribe((s) => states.push(s));
    emitError("uid1", { code: "unavailable" });
    expect(states[states.length - 1]).toEqual({ status: "error", message: expect.stringMatching(/offline/) });
  });

  it("switches lists on sign-out / another account", () => {
    const auth = fakeAuth("uid1");
    const { io, watching } = fakeIO();
    const store = createCloudShoppingStore({ subscribeUid: auth.subscribeUid, io });
    const states: ShoppingListState[] = [];
    store.subscribe((s) => states.push(s));
    auth.set("uid2");
    expect(watching()).toEqual(["uid2"]);
    expect(io.unwatched).toEqual(["uid1"]);
    auth.set(null);
    expect(watching()).toEqual([]);
    expect(states[states.length - 1]).toEqual({ status: "signed-out" });
  });
});
