import type { MeResponse } from "@recipe/shared";

// The signed-in account, cloud mode only (VITE_BACKEND=cloud). Deliberately free of Firebase
// types so the auth UI (components/account/*) can be compiled into every build while Firebase
// itself is only ever loaded — via backend/index.ts's dynamic import — in the cloud build.
// In other modes `account` (exported from backend/index.ts) is null and that UI never renders.

export interface AccountUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  /** Sign-in providers on this user, e.g. ["google.com"] or ["emailLink"]. */
  providers: Array<"google" | "emailLink" | "other">;
}

export interface Account {
  /** null = signed out; undefined = still restoring the session (first paint). */
  current(): AccountUser | null | undefined;
  /** Subscribes to sign-in/out. Called immediately with the current value. Returns unsubscribe. */
  subscribe(listener: (user: AccountUser | null | undefined) => void): () => void;

  /** Popup first; falls back to a full-page redirect when the popup is blocked. */
  signInWithGoogle(): Promise<void>;
  /** Emails a sign-in link that comes back to this page; remembers `email` in this browser. */
  sendSignInLink(email: string): Promise<void>;
  /** True when the current URL is a sign-in link (the email-link landing). */
  isSignInLink(url: string): boolean;
  /** The email `sendSignInLink` stored in this browser, if any (null on another device). */
  storedSignInEmail(): string | null;
  /** Completes an email-link sign-in, then strips the link's query from the URL. */
  completeSignInLink(email: string, url: string): Promise<void>;
  signOut(): Promise<void>;

  /** GET /me — plan and this month's usage. Cached briefly; `fresh` bypasses the cache. */
  getMe(options?: { fresh?: boolean }): Promise<MeResponse>;

  /**
   * DELETE /me, then signs out and clears this browser's local data. If the API asks for a
   * recent sign-in, re-authenticates (Google: popup) and retries; for email-link accounts it
   * sends a fresh link and resolves `{ status: "check_email" }` — the user opens the link, which
   * brings them back to Settings to confirm again.
   */
  deleteAccount(): Promise<{ status: "deleted" | "check_email" }>;

  /** Recipes made in this browser before signing in (the old local library), not yet moved. */
  countLocalRecipes(): Promise<number>;
  /** POST /import for those recipes (doesn't count against the limit). Keeps their audio here. */
  moveLocalRecipes(): Promise<{ imported: number; skipped: number }>;
}
