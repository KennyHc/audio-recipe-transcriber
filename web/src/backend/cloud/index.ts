// Cloud mode entry point (VITE_BACKEND=cloud), loaded only by backend/index.ts's dynamic
// import. Wires Firebase, the API client, the Firestore store, the shared browser pipeline,
// and the account together.

import type { MeResponse, Usage } from "@recipe/shared";
import type { Account } from "../account";
import type { Backend } from "../types";
import { createBrowserBackend } from "../browser";
import { initFirebase } from "./firebase";
import { createApiClient } from "./api";
import { createRecipeStore } from "./store";
import { createCloudBackend, type UsageCache } from "./backend";
import { createAccount } from "./account";

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

export function createCloudRuntime(): { backend: Backend; account: Account } {
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
    getAppCheckToken: firebase.getAppCheckToken,
    knownLimit: () => usage.get()?.usage.limit,
  });

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
  return { backend, account };
}
