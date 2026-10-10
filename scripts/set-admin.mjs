#!/usr/bin/env node
// Grants (or with --remove, revokes) the `admin` custom claim on a Firebase Auth user, which
// unlocks the admin queue (GET /admin/queue, POST /admin/public/:id) and admin reads in the
// Firestore rules (request.auth.token.admin == true).
//
//   gcloud auth application-default login      # once, as a project owner
//   node scripts/set-admin.mjs you@example.com
//   node scripts/set-admin.mjs you@example.com --remove
//
// Uses Application Default Credentials against project recipe-transcriber-eu. Other custom
// claims on the user are kept. The user must sign out and in again (or wait up to an hour
// for the ID token to refresh) before the claim takes effect. Prints only the uid, email,
// and resulting claims — never credentials or tokens.
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const PROJECT = "recipe-transcriber-eu";

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const email = args.find((a) => !a.startsWith("--"));
if (!email || !/^[^\s@]+@[^\s@]+$/.test(email) || args.some((a) => a.startsWith("--") && a !== "--remove")) {
  console.error("usage: node scripts/set-admin.mjs <email> [--remove]");
  process.exit(2);
}

if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.log(`note: FIREBASE_AUTH_EMULATOR_HOST is set — this targets the local Auth emulator, not production.`);
}

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const auth = getAuth(app);

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (err) {
  if (err?.code === "auth/user-not-found") {
    console.error(`No user with email ${email} in ${PROJECT}. Sign in to the app once first.`);
    process.exit(1);
  }
  console.error(`Lookup failed (${err?.code ?? "unknown error"}). Check: gcloud auth application-default login`);
  process.exit(1);
}

const claims = { ...(user.customClaims ?? {}) };
if (remove) delete claims.admin;
else claims.admin = true;

await auth.setCustomUserClaims(user.uid, claims);

console.log(`${remove ? "Removed" : "Granted"} admin for ${user.email} (uid ${user.uid}) in ${PROJECT}.`);
console.log(`Custom claims now: ${JSON.stringify(claims)}`);
console.log("They need to sign out and back in for it to take effect.");
