// Cloud mode: the signed-in account (backend/account.ts's Account) on top of Firebase Auth and
// the API — Google and email-link sign-in, sign-out, usage, account deletion, and moving the old
// local library in.

import {
  GoogleAuthProvider,
  getRedirectResult,
  isSignInWithEmailLink,
  onAuthStateChanged,
  reauthenticateWithPopup,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import type { MeResponse } from "@recipe/shared";
import type { Account, AccountUser } from "../account";
import { BROWSER_DB_NAME } from "../constants";
import * as db from "../browser/db";
import type { ApiClient } from "./api";
import { CloudApiError } from "./errors";
import type { RecipeStore } from "./store";
import type { UsageCache } from "./backend";
import { clearLocalJobOwners } from "./localJobs";
import { listLegacyJobs, moveLegacyJobs } from "./legacy";
import { REAUTH_FOR_DELETE_KEY, SIGNIN_EMAIL_KEY, clearCloudLocalPrefs } from "@/lib/accountPrefs";

function toAccountUser(user: User): AccountUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    providers: user.providerData.map((p) =>
      p.providerId === "google.com" ? "google" : p.providerId === "password" || p.providerId === "emailLink" ? "emailLink" : "other",
    ),
  };
}

function authErrorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
}

function friendlyAuthMessage(err: unknown): string {
  switch (authErrorCode(err)) {
    case "auth/invalid-email":
      return "That doesn't look like an email address.";
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return "This sign-in link has expired or was already used. Ask for a new one.";
    case "auth/network-request-failed":
      return "Couldn't reach the sign-in service. Check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/unauthorized-domain":
    case "auth/unauthorized-continue-uri":
      return "Sign-in isn't set up for this address yet.";
    case "auth/account-exists-with-different-credential":
      return "This email already signs in another way — use the email link instead.";
    case "auth/user-mismatch":
      return "That's a different account. Sign in with the account you want to delete.";
    default:
      return err instanceof Error && err.message ? err.message : "Sign-in failed. Please try again.";
  }
}

function setPref(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function getPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The page the email link brings people back to (the query keeps it clear of the hash router). */
function signInLinkUrl(): string {
  return `${window.location.origin}${window.location.pathname}?finishSignIn=1`;
}

async function deleteLocalDatabase(): Promise<void> {
  await db.closeDbConnection();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(BROWSER_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export interface AccountDeps {
  auth: Auth;
  api: ApiClient;
  store: RecipeStore;
  usage: UsageCache;
}

export function createAccount({ auth, api, store, usage }: AccountDeps): Account {
  let user: AccountUser | null | undefined = undefined;
  const listeners = new Set<(u: AccountUser | null | undefined) => void>();
  let meFetchedAt = 0;

  onAuthStateChanged(auth, (u) => {
    const next = u ? toAccountUser(u) : null;
    if (user?.uid !== next?.uid) {
      store.reset();
      meFetchedAt = 0;
    }
    user = next;
    for (const l of listeners) l(user);
  });
  // Finishes a Google sign-in that fell back to a full-page redirect.
  getRedirectResult(auth).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Google sign-in (redirect) failed:", friendlyAuthMessage(err));
  });

  async function sendLink(email: string): Promise<void> {
    try {
      await sendSignInLinkToEmail(auth, email, { url: signInLinkUrl(), handleCodeInApp: true });
    } catch (err) {
      throw new Error(friendlyAuthMessage(err));
    }
    setPref(SIGNIN_EMAIL_KEY, email);
  }

  async function clearEverythingLocal(): Promise<void> {
    store.reset();
    await deleteLocalDatabase();
    clearLocalJobOwners();
    clearCloudLocalPrefs();
  }

  return {
    current: () => user,

    subscribe(listener) {
      listeners.add(listener);
      listener(user);
      return () => listeners.delete(listener);
    },

    async signInWithGoogle() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        const code = authErrorCode(err);
        if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
          await signInWithRedirect(auth, provider);
          return;
        }
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
        throw new Error(friendlyAuthMessage(err));
      }
    },

    sendSignInLink: sendLink,

    isSignInLink: (url) => isSignInWithEmailLink(auth, url),

    storedSignInEmail: () => getPref(SIGNIN_EMAIL_KEY),

    async completeSignInLink(email, url) {
      try {
        await signInWithEmailLink(auth, email.trim(), url);
      } catch (err) {
        throw new Error(friendlyAuthMessage(err));
      }
      setPref(SIGNIN_EMAIL_KEY, null);
      const backToSettings = getPref(REAUTH_FOR_DELETE_KEY) !== null;
      setPref(REAUTH_FOR_DELETE_KEY, null);
      window.history.replaceState(null, "", `${window.location.pathname}${backToSettings ? "#/settings" : "#/"}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    },

    async signOut() {
      store.reset();
      await firebaseSignOut(auth);
    },

    async getMe(options) {
      const cached = usage.get();
      if (!options?.fresh && cached && cached.uid === user?.uid && Date.now() - meFetchedAt < 60_000) return cached;
      const me: MeResponse = await api.getMe();
      usage.set(me);
      meFetchedAt = Date.now();
      return me;
    },

    async deleteAccount() {
      const current = auth.currentUser;
      if (!current) throw new Error("Sign in to delete your account.");
      try {
        await api.deleteMe();
      } catch (err) {
        if (!(err instanceof CloudApiError) || err.code !== "unauthenticated") throw err;
        // The API wants a recent sign-in before deleting everything.
        const providers = toAccountUser(current).providers;
        if (providers.includes("google")) {
          try {
            await reauthenticateWithPopup(current, new GoogleAuthProvider());
          } catch (reauthErr) {
            throw new Error(friendlyAuthMessage(reauthErr));
          }
          await api.deleteMe({ forceRefreshToken: true });
        } else if (current.email) {
          setPref(REAUTH_FOR_DELETE_KEY, "1");
          await sendLink(current.email);
          return { status: "check_email" };
        } else {
          throw err;
        }
      }
      await clearEverythingLocal();
      await firebaseSignOut(auth).catch(() => undefined); // the Auth user is already gone
      return { status: "deleted" };
    },

    async countLocalRecipes() {
      if (!user) return 0;
      return (await listLegacyJobs()).length;
    },

    async moveLocalRecipes() {
      if (!user) throw new Error("Sign in to move your recipes.");
      const result = await moveLegacyJobs({
        api,
        isInAccount: (id) =>
          store.getRecipe(id).then(
            () => true,
            () => false,
          ),
      });
      meFetchedAt = 0;
      return result;
    },
  };
}
