// Cloud mode entry point (VITE_BACKEND=cloud), loaded only by backend/index.ts's dynamic
// import. Wires Firebase, the API client, the Firestore store, the shared browser pipeline,
// and the account together.

import type { MeResponse, Usage } from "@recipe/shared";
import type { Account } from "../account";
import type { PublicBank } from "../publicBank";
import type { Backend } from "../types";
import { createBrowserBackend } from "../browser";
import { initFirebase } from "./firebase";
import { createApiClient } from "./api";
import { createRecipeStore } from "./store";
import { createCloudBackend, type UsageCache } from "./backend";
import { createAccount } from "./account";
import { createPublicBank } from "./publicBank";
import { createCloudShoppingStore, firestoreShoppingIO } from "./shoppingList";
import type { ShoppingListStore } from "../shoppingList";
import { errorReporter } from "@/lib/errorReporting";

function createUsageCache(): UsageCache {
  let me: MeResponse | null = null;
  return {
    get: () => me,
    set: (next) => {
      me = next;
    },
    setUsage: (usage: Usage) => {
      if (me) me = { ...me, usage };
    },
  };
}

export function createCloudRuntime(): {
  backend: Backend;
  account: Account;
  publicBank: PublicBank;
  shoppingList: ShoppingListStore;
} {
  const firebase = initFirebase();
  const { auth } = firebase;
  const usage = createUsageCache();

  const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:8080";
  const api = createApiClient({
    baseUrl: apiBase,
    async getIdToken(forceRefresh) {
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) throw new Error("Sign in to continue.");
      return user.getIdToken(forceRefresh);
    },
    isSignedIn: () => auth.currentUser !== null,
    getAppCheckToken: firebase.getAppCheckToken,
    knownLimit: () => usage.get()?.usage.limit,
    onUnexpectedFailure: (route, error) => {
      errorReporter.report({ kind: "api", stage: route, code: error.code, error });
    },
  });
  // Error reports go to the API (fire-and-forget; see lib/errorReporting.ts).
  errorReporter.setSender((report) => api.reportClientError(report));

  const store = createRecipeStore(firebase.firestore);

  const backend = createCloudBackend({
    session: {
      async requireUid() {
        await auth.authStateReady();
        const user = auth.currentUser;
        if (!user) throw new Error("Sign in to continue.");
        return user.uid;
      },
      currentUid: () => auth.currentUser?.uid ?? null,
    },
    store,
    api,
    usage,
    local: createBrowserBackend(),
  });

  const account = createAccount({ auth, api, store, usage });

  // The public bank works signed out too: Firestore reads need no sign-in (rules allow live
  // public recipes), and reports need only App Check.
  const bank = createPublicBank({
    firestore: firebase.firestore,
    api,
    async currentUid() {
      await auth.authStateReady();
      return auth.currentUser?.uid ?? null;
    },
  });
  const publicBank: PublicBank = {
    ...bank,
    async copy(publicId) {
      const recipe = await bank.copy(publicId);
      const uid = auth.currentUser?.uid;
      if (uid) store.noteRecipe(uid, recipe); // so the library/recipe page show it right away
      return recipe;
    },
  };
  const shoppingList = createCloudShoppingStore({
    subscribeUid: (listener) => account.subscribe((user) => listener(user === undefined ? undefined : (user?.uid ?? null))),
    io: firestoreShoppingIO(firebase.firestore),
  });

  return { backend, account, publicBank, shoppingList };
}
