# Phase 1 build plan: accounts + cloud library

Goal: people sign in (Google or email link) and their recipes are saved to their account in
the EU, private by default, usable on any device. Free with a usage limit. No publishing yet
(Phase 2), no payments (deferred).

Context and decisions: SAAS-PLAN.md.

## What the user sees

1. Signed out: the library page explains the app and shows **Sign in to start** (Google
   button, or "Email me a sign-in link"). Privacy page and cook mode for already-open
   recipes stay reachable.
2. Signed in: same app as today. Avatar menu (top right): account email, usage
   ("4 of 30 recipes this month"), Settings, Sign out.
3. Recipes appear on every device the user signs in on. Transcription still runs on the
   device; the audio stays on that device (click-to-hear works where the audio is, and is
   hidden on other devices with a short note).
4. First sign-in on a browser that has a local library: **"Move your 3 recipes into your
   account?"** — uses the existing backup format; doesn't count against the limit.
5. Settings → Account: download all my data (backup file), delete my account (deletes
   everything, confirm by typing the email).

## Limits (free)

| Limit | Start value | Where |
|---|---|---|
| Recipes created per account per month (incl. re-extracts) | 30 | `users/{uid}.usage`, API transaction |
| Global Claude budget per day | $2 | `system/budget-{date}`, API transaction |
| Max transcript size | 40k chars (as today) | API validation |
| Abuse | App Check (reCAPTCHA Enterprise) + signed-in only | API middleware |

All configurable by env var on the API; numbers are a starting point to tune.

## Architecture

```
web (Cloudflare Pages, VITE_BACKEND=cloud)
  ├─ Firebase Auth  → ID token
  ├─ Firestore SDK  → read own recipes/versions; write edits (rules-enforced)
  └─ fetch → Cloud Run "api" (europe-west1)
        Authorization: Bearer <ID token>, X-Firebase-AppCheck: <token>
        POST /recipes               {transcript, fileName, source?} → extract+verify, save v1
        POST /recipes/:id/reextract {}                              → new version "reextracted"
        POST /import                {LibraryBackup}                 → bulk import, no quota
        GET  /me                                                    → plan, usage, limits
        DELETE /me                                                  → delete all data + auth user
```

Why the API writes extracted versions (not the browser): it's what makes the quota real —
a client can't create "extracted" recipes without going through the counter.

**What the browser may write directly** (Firestore Security Rules):
- new versions with `source` in `edited | rollback` on its own recipes, and the recipe's
  denormalized latest fields to match;
- its own transcript (`recipes/{id}/private/transcript`);
- recipe title/visibility (`private` only in Phase 1).
- Never: `usage`, `plan`, `ownerId`, versions with source `extracted | reextracted`.

## Data model (Phase 1 subset of SAAS-PLAN.md §3)

```
users/{uid}            email, displayName, photoURL, createdAt,
                       usage: { month: "2026-10", recipesCreated }     (API only)
recipes/{id}           ownerId, visibility:"private", title, fileName, createdAt, updatedAt,
                       currentVersion, latest: Recipe                  (denormalized for lists)
recipes/{id}/versions/{n}          VersionedRecipe (as today)
recipes/{id}/private/transcript    Transcript (owner only)
system/budget-{YYYY-MM-DD}         { reservedUsd, settledUsd }        (API only)
```

Local-only (IndexedDB, per device): audio blobs keyed by recipe id, in-progress transcription
state, speech model cache. A recipe exists in Firestore only once extraction succeeds.

## Code changes

| Area | Change |
|---|---|
| `shared/cloud.ts` (new) | Zod contract for the API above (requests, responses, error codes incl. `quota_exceeded`, `budget_exhausted`, `unauthenticated`, `app_check_failed`) |
| `api/` (new workspace) | Hono on Node for Cloud Run: `firebase-admin` token + App Check verification, quota/budget transactions (port `worker/src/budget.ts` logic), Claude calls via shared prompts + `finalizeWarnings`, Firestore writes, `/import`, `/me`, account deletion. Dockerfile. Anthropic key from Secret Manager (env var). |
| `firestore.rules`, `firestore.indexes.json`, `firebase.json` (new) | Rules above; index on `recipes(ownerId, updatedAt desc)` |
| `web/src/backend/cloud/` (new) | `Backend` implementation: Firebase Auth + Firestore SDK + API client; reuses the browser pipeline for transcription and IndexedDB for audio |
| `web` auth UI (new) | Sign-in page (Google, email link incl. the link-landing route), account menu, signed-out landing, import prompt, account settings |
| `web/package.json` | `build:cloud` / `deploy:site` for cloud mode (same no-secrets scan; Firebase web config is public by design) |
| `worker/` | Unchanged; keeps serving the anonymous version until cutover, then retired |
| CI | Firebase Emulator Suite (Auth + Firestore) for rules tests and API integration tests |

## Testing

- **Rules tests** (`@firebase/rules-unit-testing` on the emulator): user A can't read/write
  user B's recipes or transcript; nobody can write `usage`, `extracted` versions, or change
  `ownerId`; owner can save edits and restores.
- **API tests** (emulator + mocked Anthropic SDK): auth/App Check required; quota decrement
  and refusal at the limit; budget reserve/settle/release (incl. the midnight case); recipe
  + v1 + transcript written; re-extract; import idempotent; account deletion removes everything.
- **Web**: cloud backend unit tests; manual end-to-end with the real project before cutover
  (sign in both ways, create, edit, re-extract, second device, import, delete account).

## Your setup steps (need your Google login; ~20 min)

1. Google Cloud console: create project (e.g. `recipe-transcriber`), link billing.
2. Firebase console: add Firebase to that project.
3. Authentication → enable **Google** and **Email link (passwordless)**; Settings → Authorized
   domains → add `recipe-transcriber.pages.dev` (localhost is there by default).
4. Firestore → create database, **location `eur3`** (permanent), production mode.
5. App Check → register the web app with reCAPTCHA Enterprise.
6. Billing → Budgets & alerts: e.g. $20/month with alerts at 50/90/100%.
7. Terminal: `gcloud auth login` and `gcloud config set project <id>`; install the Firebase
   CLI (`npm i -g firebase-tools`, then `firebase login`).
8. Secret Manager: create `anthropic-api-key` (you paste the key in the console or via
   `gcloud secrets create … --data-file=-`; it never goes through me).

`gcloud` and Java (for the emulators) are already installed on this Mac; the Firebase CLI isn't.

## Order of work

1. Contract (`shared/cloud.ts`) + rules + rules tests — I write these first so the parts fit.
2. In parallel: **API** (agent) and **web cloud backend + auth UI** (agent), both against the
   emulators, no real project needed.
3. Integrate on emulators; CI green.
4. With your project set up: deploy rules/indexes and the API (`gcloud run deploy --source .
   --region europe-west1`), build the site in cloud mode, deploy to Pages.
5. End-to-end check on the live site; then retire the anonymous Worker path (keep the
   redirect/BYOK/local modes).

Estimate: ~1–1.5 weeks of agent work; your part is the setup steps and a final review.

## Costs in Phase 1

Firestore, Cloud Run, Auth, App Check: within free tiers at this size (≈ $0). Secret Manager
≈ $0.06/month. Claude ≈ $0.015 per recipe, capped by the $2/day budget (≤ $60/month worst case)
and the Anthropic Console limit.
