// Where the shopping list lives. Cloud mode keeps it in Firestore (users/{uid}/lists/shopping,
// see cloud/shoppingList.ts — loaded only by the cloud runtime, so no Firebase here); every other
// mode keeps it in this browser's localStorage. The list logic itself is lib/shopping.ts.

import type { ShoppingListDoc } from "@recipe/shared";
import { emptyList, parseStoredList } from "@/lib/shopping";

export type ShoppingListState =
  | { status: "loading" }
  /** Cloud mode, signed out: the list needs an account. */
  | { status: "signed-out" }
  | { status: "ready"; list: ShoppingListDoc; /** A save failed (shown, list still usable). */ error?: string | null }
  | { status: "error"; message: string };

export interface ShoppingListStore {
  /** Calls `listener` now (with the current state) and on every change. Returns unsubscribe. */
  subscribe(listener: (state: ShoppingListState) => void): () => void;
  /**
   * Read-modify-write of the whole list. `fn` gets the latest list and returns the next one (or
   * null to leave it unchanged). Resolves with what `fn` returned. Rejects with a friendly message
   * when signed out (cloud) — never because storage is unavailable (the list then lives in memory).
   */
  update<T extends { list: ShoppingListDoc } | ShoppingListDoc>(fn: (list: ShoppingListDoc) => T | null): Promise<T | null>;
}

export const SHOPPING_STORAGE_KEY = "recipe-transcriber:shopping-list";

/** Just enough of the Storage API (so tests can pass a fake, and a throwing one). */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // e.g. blocked site data
  }
}

export function listOf(result: { list: ShoppingListDoc } | ShoppingListDoc): ShoppingListDoc {
  return "list" in result ? result.list : result;
}

/** localStorage-backed list (server / browser / hosted modes). Works without storage, in memory. */
export function createLocalShoppingStore(storage: KeyValueStorage | null = defaultStorage()): ShoppingListStore {
  const listeners = new Set<(state: ShoppingListState) => void>();
  let cache: ShoppingListDoc | null = null;
  let saveError: string | null = null;

  function read(): ShoppingListDoc {
    if (cache) return cache;
    let stored: ShoppingListDoc | null = null;
    try {
      const raw = storage?.getItem(SHOPPING_STORAGE_KEY);
      if (raw) stored = parseStoredList(JSON.parse(raw));
    } catch {
      stored = null; // unreadable or unparsable — start fresh
    }
    cache = stored ?? emptyList();
    return cache;
  }

  function write(list: ShoppingListDoc) {
    cache = list;
    try {
      storage?.setItem(SHOPPING_STORAGE_KEY, JSON.stringify(list));
      saveError = null;
    } catch {
      saveError = "Couldn't save your list in this browser — it will be lost when you close the tab.";
    }
  }

  function emit() {
    const state: ShoppingListState = { status: "ready", list: read(), error: saveError };
    for (const l of listeners) l(state);
  }

  // Another tab changed the list.
  if (typeof window !== "undefined" && storage) {
    try {
      window.addEventListener("storage", (event) => {
        if (event.key !== SHOPPING_STORAGE_KEY) return;
        cache = null;
        emit();
      });
    } catch {
      /* no window events (tests) */
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener({ status: "ready", list: read(), error: saveError });
      return () => listeners.delete(listener);
    },
    async update(fn) {
      const result = fn(read());
      if (result === null) return null;
      write(listOf(result));
      emit();
      return result;
    },
  };
}
