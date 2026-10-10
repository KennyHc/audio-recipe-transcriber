# api — Cloud Run backend for the signed-in ("cloud") mode

Hono on Node. Verifies Firebase ID tokens + App Check, enforces the per-user monthly quota
and the global daily Claude budget (Firestore transactions), runs extract + verify with the
shared prompts, and writes recipes with firebase-admin. Contracts: `shared/cloud.ts` (Phase 1)
and `shared/public.ts` (Phase 2: publishing + the public recipe bank). Plans: `PHASE1-PLAN.md`,
`PHASE2-PLAN.md`.

| Route | |
|---|---|
| `GET /health` | no auth |
| `POST /recipes` | extract + verify + save v1; idempotent on `id`; counts 1 |
| `POST /recipes/:id/reextract` | new `reextracted` version from the saved transcript; counts 1 |
| `POST /import` | bulk import of a local library; no Claude, no quota |
| `GET /me` | plan + usage; creates `users/{uid}` |
| `DELETE /me` | unpublishes everything (+ source mappings), frees the handle, gives back likes/saves counts (best effort), then deletes all recipes, the user doc, and the Auth user (sign-in < 10 min old) |

Phase 2 (`shared/public.ts`; all need App Check):

| Route | Auth | |
|---|---|---|
| `GET /sources/preview?url=` | signed in | platform/videoId/canonical URL + oEmbed credit; `existingPublicId` if a live public page exists |
| `POST /recipes/:id/publish` | owner | first publish or "Update public version"; handle reserved on first publish; oEmbed credit; duplicate-video check (409); Haiku screening (global budget, fails safe to `review`); 20/day |
| `DELETE /recipes/:id/publish` | owner or admin | deletes the snapshot + its `sources` mapping; idempotent (204) |
| `POST`/`DELETE /public/:id/like`, `…/save` | signed in | idempotent; stats + score in one transaction; POST needs a live recipe, DELETE also clears a dangling one; 300 changes/day |
| `POST /public/:id/copy` | signed in | private copy (v1 `edited`, note "Copied from @handle's recipe"); no Claude, no quota; counts toward the 300/day |
| `POST /public/:id/report` | ID token optional | report/claim (claims need `contact`); 10/day per user and per hashed IP; 202 |
| `GET /admin/queue`, `POST /admin/public/:id` | `admin` claim | open reports newest first + their recipe; `hide` / `restore` / `dismiss` |

**Outgoing requests (SSRF):** only `https://www.youtube.com/oembed`, `https://www.tiktok.com/oembed`,
and TikTok short-link redirects (every hop must stay on `*.tiktok.com`), 5 s timeout each.
Links to other sites are parsed and stored, never fetched; non-http(s), credentials, and
private/loopback/link-local hosts are refused.

**Reporter IPs:** the last `X-Forwarded-For` hop (the one Google appends; earlier hops can
be forged by the client), hashed with `REPORT_SALT` and stored as `system/report-ip-{hash}`
with an `expiresAt` field — add a Firestore TTL policy on `system.expiresAt` to clean them up.
Deleting an account strips `reporterUid` and `contact` from the reports it filed.

**Alerts:** structured log lines `{"event":"report_created", kind, publicRecipeId}` and
`{"event":"publish_flagged", publicRecipeId, screening}` (never the reason, contact, or IP) —
key Cloud Monitoring log-based alerts on `jsonPayload.event`.

**Admins:** `node scripts/set-admin.mjs you@example.com` (Application Default Credentials,
project `recipe-transcriber-eu`; `--remove` to revoke). Sign out/in afterwards.

## Environment

| Var | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — (required) | From Secret Manager (`anthropic-api-key`) at deploy time. Never logged. |
| `EXTRACTOR_MODEL` / `VERIFIER_MODEL` / `SCREENING_MODEL` | `claude-haiku-4-5` | |
| `REPORT_SALT` | — (required in production) | Salt for hashing reporter IPs. Secret Manager `report-salt` (created by deploy-api.sh). A fixed dev value is used against the emulators. Never logged. |
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

`test/emulator/*` mint real ID tokens from the Auth emulator and use a fake Claude, a fake
`fetch` (no network — oEmbed and short links come from tables in `test/fixtures.ts`), and a
controllable clock (`createApp(deps)`); they're skipped when the emulator env vars aren't set.

## Build and deploy

```sh
npm run build -w api            # esbuild → api/dist/server.js (src + @recipe/shared bundled)
bash scripts/deploy-api.sh      # SA + IAM (idempotent), build, gcloud run deploy, smoke test
```

The image (`api/Dockerfile`, node:24-slim, non-root) contains only `dist/` and the runtime
dependencies. Cloud Run: `europe-west1`, service `api`, service account `api-runner`
(`roles/datastore.user`, `roles/firebaseauth.admin`, secretAccessor on `anthropic-api-key`
and `report-salt` only), max 3 instances, 120 s timeout.

## Logging

One JSON line per event (Cloud Logging parses `severity`/`message`). Request lines carry
method, path, status, latency, uid; Claude lines carry tokens and cost. Never transcripts,
recipes, tokens, or the key — error text is passed through `sanitizedErrorLog` first.
