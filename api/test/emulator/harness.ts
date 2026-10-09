/**
 * Shared setup for tests that run against the Firebase emulators (started by
 * `npm test -w api` via `firebase emulators:exec`). Real ID tokens come from the Auth
 * emulator's REST API; firebase-admin verifies them in emulator mode.
 */
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import type { Hono } from "hono";
import { createApp } from "../../src/app";
import type { AuthVariables } from "../../src/auth";
import type { Config } from "../../src/config";
import { silentLogger } from "../../src/log";
import { FakeClaude, TestClock, testConfig } from "../fixtures";

export const EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
export const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "demo-recipe";

let adminApp: App | null = null;

export function admin(): { db: Firestore; auth: Auth } {
  adminApp ??= initializeApp({ projectId: PROJECT_ID }, `api-test-${Math.random()}`);
  return { db: getFirestore(adminApp), auth: getAuth(adminApp) };
}

export async function closeAdmin(): Promise<void> {
  if (adminApp) await deleteApp(adminApp);
  adminApp = null;
}

/** Wipes all Firestore data and Auth users between tests. */
export async function resetEmulators(): Promise<void> {
  const fs = process.env.FIRESTORE_EMULATOR_HOST;
  const au = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const r1 = await fetch(`http://${fs}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: "DELETE",
  });
  const r2 = await fetch(`http://${au}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  if (!r1.ok || !r2.ok) throw new Error(`emulator reset failed: ${r1.status} ${r2.status}`);
}

export interface TestUser {
  uid: string;
  idToken: string;
  email: string;
}

/** Creates an Auth emulator user and signs in (email/password) to get a real ID token. */
export async function signUp(email: string, displayName = "Test Cook"): Promise<TestUser> {
  const base = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
  // The emulator accepts any API key; the password is a throwaway test value.
  const res = await fetch(`${base}/accounts:signUp?key=emulator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: `pw-${Math.random()}`, displayName, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`signUp failed: ${res.status}`);
  const data = (await res.json()) as { localId: string; idToken: string };
  return { uid: data.localId, idToken: data.idToken, email };
}

export interface Harness {
  app: Hono<{ Variables: AuthVariables }>;
  db: Firestore;
  auth: Auth;
  claude: FakeClaude;
  clock: TestClock;
}

export function harness(config: Partial<Config> = {}, clockStart = "2026-10-15T12:00:00Z"): Harness {
  const { db, auth } = admin();
  const claude = new FakeClaude();
  const clock = new TestClock(new Date(clockStart));
  const app = createApp({
    db,
    auth,
    appCheck: { verifyToken: async () => ({}) }, // REQUIRE_APP_CHECK=false in these tests
    claude,
    config: testConfig({ requireAppCheck: false, ...config }),
    now: clock.now,
    logger: silentLogger,
  });
  return { app, db, auth, claude, clock };
}

export function call(
  h: Harness,
  user: TestUser | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (user) headers.Authorization = `Bearer ${user.idToken}`;
  return Promise.resolve(
    h.app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
}
