// Cloud mode: the shopping list in Firestore at users/{uid}/lists/shopping (contract:
// shared/shopping.ts; rules: the owner may read/write that one doc with keys {items, updatedAt}).
// Live via onSnapshot while something is showing it; every change writes the whole doc.
//
// The Firestore calls sit behind ShoppingDocIO so the state machine (signed out / loading /
// ready, optimistic updates, write failures) is tested without Firebase.

import { doc, getDoc, onSnapshot, setDoc, type Firestore } from "firebase/firestore";
import { SHOPPING_LIST_DOC, type ShoppingListDoc } from "@recipe/shared";
import { emptyList, parseStoredList } from "@/lib/shopping";
import { listOf, type ShoppingListState, type ShoppingListStore } from "../shoppingList";

export interface ShoppingDocIO {
  /** Live updates of the doc's data (null when it doesn't exist yet). Returns unsubscribe. */
  watch(uid: string, onNext: (data: unknown | null) => void, onError: (err: unknown) => void): () => void;
  read(uid: string): Promise<unknown | null>;
  write(uid: string, list: ShoppingListDoc): Promise<void>;
}

export function firestoreShoppingIO(firestore: Firestore): ShoppingDocIO {
  const ref = (uid: string) => doc(firestore, "users", uid, "lists", SHOPPING_LIST_DOC);
  return {
    watch: (uid, onNext, onError) =>
      onSnapshot(
        ref(uid),
        (snap) => onNext(snap.exists() ? snap.data() : null),
        (err) => onError(err),
      ),
    async read(uid) {
      const snap = await getDoc(ref(uid));
      return snap.exists() ? snap.data() : null;
    },
    // Only the two allowed keys — never spread anything else into the doc.
    write: (uid, list) => setDoc(ref(uid), { items: list.items, updatedAt: list.updatedAt }),
  };
}

export const SIGN_IN_FOR_LIST_MESSAGE = "Sign in to use your shopping list.";

function listErrorMessage(err: unknown): string {
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  switch (code) {
    case "unauthenticated":
    case "permission-denied":
      return "Sign in again to see your shopping list.";
    case "unavailable":
      return "You're offline — your list will sync when you reconnect.";
    default:
      return "Something went wrong with your shopping list. Please try again.";
  }
}

export function createCloudShoppingStore(deps: {
  /** Signed-in uid: undefined while restoring, null when signed out. Calls back immediately. */
  subscribeUid(listener: (uid: string | null | undefined) => void): () => void;
  io: ShoppingDocIO;
}): ShoppingListStore {
  const listeners = new Set<(state: ShoppingListState) => void>();
  let uid: string | null | undefined = undefined;
  let list: ShoppingListDoc | null = null; // latest known list for `uid`
  let state: ShoppingListState = { status: "loading" };
  let stopWatch: (() => void) | null = null;
  let watchedUid: string | null = null;
  let uidWaiters: Array<(uid: string | null) => void> = [];

  function set(next: ShoppingListState) {
    state = next;
    for (const l of listeners) l(state);
  }

  function stopWatching() {
    stopWatch?.();
    stopWatch = null;
    watchedUid = null;
  }

  function startWatching() {
    if (!uid || watchedUid === uid || listeners.size === 0) return;
    stopWatching();
    const forUid = uid;
    watchedUid = forUid;
    stopWatch = deps.io.watch(
      forUid,
      (data) => {
        if (uid !== forUid) return;
        list = (data === null ? null : parseStoredList(data)) ?? emptyList();
        set({ status: "ready", list, error: state.status === "ready" ? (state.error ?? null) : null });
      },
      (err) => {
        if (uid !== forUid) return;
        set({ status: "error", message: listErrorMessage(err) });
      },
    );
  }

  function onUid(next: string | null | undefined) {
    if (next === uid) return;
    uid = next;
    list = null;
    stopWatching();
    if (next === undefined) {
      set({ status: "loading" });
      return;
    }
    const waiters = uidWaiters;
    uidWaiters = [];
    for (const w of waiters) w(next);
    if (next === null) {
      set({ status: "signed-out" });
      return;
    }
    set({ status: "loading" });
    startWatching();
  }

  deps.subscribeUid(onUid);

  function resolvedUid(): Promise<string | null> {
    if (uid !== undefined) return Promise.resolve(uid);
    return new Promise((resolve) => uidWaiters.push(resolve));
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      startWatching();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopWatching();
      };
    },
    async update(fn) {
      const forUid = await resolvedUid();
      if (!forUid) throw new Error(SIGN_IN_FOR_LIST_MESSAGE);
      let current = uid === forUid ? list : null;
      if (!current) {
        try {
          current = parseStoredList(await deps.io.read(forUid)) ?? emptyList();
        } catch (err) {
          throw new Error(listErrorMessage(err));
        }
      }
      const result = fn(current);
      if (result === null) return null;
      const next = listOf(result);
      if (uid === forUid) {
        list = next;
        set({ status: "ready", list: next, error: null });
      }
      // Not awaited: offline, Firestore applies the write locally (the snapshot shows it) and
      // syncs later — the promise only settles once the server has it.
      deps.io.write(forUid, next).catch((err: unknown) => {
        if (uid !== forUid) return;
        const message = listErrorMessage(err);
        set(state.status === "ready" ? { ...state, error: `Couldn't save your list: ${message}` } : { status: "error", message });
      });
      return result;
    },
  };
}
