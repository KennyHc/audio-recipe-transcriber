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
import type { LogFields, Logger, Severity } from "../../src/log";
import { FakeClaude, FakeFetch, TestClock, testConfig } from "../fixtures";

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
  /** Throwaway emulator password, so tests can sign in again (e.g. after setting claims). */
  password: string;
}

const authBase = () => `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

/** Creates an Auth emulator user and signs in (email/password) to get a real ID token. */
export async function signUp(email: string, displayName = "Test Cook"): Promise<TestUser> {
  // The emulator accepts any API key; the password is a throwaway test value.
  const password = `pw-${Math.random()}`;
  const res = await fetch(`${authBase()}/accounts:signUp?key=emulator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`signUp failed: ${res.status}`);
  const data = (await res.json()) as { localId: string; idToken: string };
  return { uid: data.localId, idToken: data.idToken, email, password };
}

/** Signs in again for a fresh ID token (picks up custom claims set since). */
export async function signIn(user: TestUser): Promise<TestUser> {
  const res = await fetch(`${authBase()}/accounts:signInWithPassword?key=emulator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`signIn failed: ${res.status}`);
  const data = (await res.json()) as { idToken: string };
  return { ...user, idToken: data.idToken };
}

/** A signed-up user carrying the `admin: true` custom claim (as scripts/set-admin.mjs sets). */
export async function signUpAdmin(email: string): Promise<TestUser> {
  const user = await signUp(email, "Admin");
  await admin().auth.setCustomUserClaims(user.uid, { admin: true });
  return signIn(user);
}

export interface Harness {
  app: Hono<{ Variables: AuthVariables }>;
  db: Firestore;
  auth: Auth;
  claude: FakeClaude;
  clock: TestClock;
  fetch: FakeFetch;
  /** Everything the app logged (instead of printing it). */
  logs: Array<{ severity: Severity; message: string; fields: LogFields }>;
}

export function harness(config: Partial<Config> = {}, clockStart = "2026-10-15T12:00:00Z"): Harness {
  const { db, auth } = admin();
  const claude = new FakeClaude();
  const clock = new TestClock(new Date(clockStart));
  const fakeFetch = new FakeFetch();
  const logs: Harness["logs"] = [];
  const logger: Logger = { log: (severity, message, fields = {}) => logs.push({ severity, message, fields }) };
  const app = createApp({
    db,
    auth,
    appCheck: { verifyToken: async () => ({}) }, // REQUIRE_APP_CHECK=false in these tests
    claude,
    config: testConfig({ requireAppCheck: false, ...config }),
    now: clock.now,
    logger,
    fetch: fakeFetch.fn,
  });
  return { app, db, auth, claude, clock, fetch: fakeFetch, logs };
}

export function call(
  h: Harness,
  user: TestUser | null,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  if (user) headers.Authorization = `Bearer ${user.idToken}`;
  return Promise.resolve(
    h.app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
}
