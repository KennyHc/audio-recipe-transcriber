# api — Cloud Run backend for the signed-in ("cloud") mode

Hono on Node. Verifies Firebase ID tokens + App Check, enforces the per-user monthly quota
and the global daily Claude budget (Firestore transactions), runs extract + verify with the
shared prompts, and writes recipes with firebase-admin. Contract: `shared/cloud.ts`.
Plan: `PHASE1-PLAN.md`.

| Route | |
|---|---|
| `GET /health` | no auth |
| `POST /recipes` | extract + verify + save v1; idempotent on `id`; counts 1 |
| `POST /recipes/:id/reextract` | new `reextracted` version from the saved transcript; counts 1 |
| `POST /import` | bulk import of a local library; no Claude, no quota |
| `GET /me` | plan + usage; creates `users/{uid}` |
| `DELETE /me` | deletes all recipes, the user doc, and the Auth user (sign-in < 10 min old) |

## Environment

| Var | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — (required) | From Secret Manager (`anthropic-api-key`) at deploy time. Never logged. |
| `EXTRACTOR_MODEL` / `VERIFIER_MODEL` | `claude-haiku-4-5` | |
| `DAILY_BUDGET_USD` | `2` | Global Claude spend per UTC day (`system/budget-YYYY-MM-DD`) |
| `FREE_MONTHLY_RECIPES` | `30` | Per user per UTC month, incl. re-extracts |
| `ALLOWED_ORIGINS` | `https://recipe-transcriber.pages.dev` | Comma list. With emulators, `http://localhost:5180`–`5184` are added. |
| `REQUIRE_APP_CHECK` | `true` | `false` only allowed when `FIRESTORE_EMULATOR_HOST` is set |
| `PORT` | `8080` | |

The server refuses to start on a missing key or an invalid number (a NaN budget would
silently disable the cap).

## Local dev against the emulators

```sh
# terminal 1 — Auth (9099) + Firestore (8085) emulators
npm run emulators -w firebase-config

# terminal 2 — the API on :8080
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
GCLOUD_PROJECT=demo-recipe REQUIRE_APP_CHECK=false \
ANTHROPIC_API_KEY=... npm run dev -w api
```

Without a real key every Claude call fails with `upstream_error` (and refunds the quota);
everything else works.

## Tests

```sh
npm test -w api                 # all tests, inside `firebase emulators:exec` (needs Java)
cd api && npx vitest run test/unit   # pure + HTTP-layer tests, no emulator
```

`test/emulator/*` mint real ID tokens from the Auth emulator and use a fake Claude and a
controllable clock (`createApp(deps)`); they're skipped when the emulator env vars aren't set.

## Build and deploy

```sh
npm run build -w api            # esbuild → api/dist/server.js (src + @recipe/shared bundled)
bash scripts/deploy-api.sh      # SA + IAM (idempotent), build, gcloud run deploy, smoke test
```

The image (`api/Dockerfile`, node:24-slim, non-root) contains only `dist/` and the runtime
dependencies. Cloud Run: `europe-west1`, service `api`, service account `api-runner`
(`roles/datastore.user`, `roles/firebaseauth.admin`, secretAccessor on `anthropic-api-key`
only), max 3 instances, 120 s timeout.

## Logging

One JSON line per event (Cloud Logging parses `severity`/`message`). Request lines carry
method, path, status, latency, uid; Claude lines carry tokens and cost. Never transcripts,
recipes, tokens, or the key — error text is passed through `sanitizedErrorLog` first.
