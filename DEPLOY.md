# Deploying

**Live since 2026-10-09: the signed-in version ("cloud" mode).** recipe-transcriber.pages.dev
and **recipe-transcriber-eu.web.app** (Firebase Hosting — use this one from Spain on football
match days, when ISPs block Cloudflare IP ranges) serve the cloud build; its backend is on Google Cloud (project `recipe-transcriber-eu`).
The anonymous Cloudflare Worker below still runs, so switching back is one `npm run deploy:site`.

## Signed-in version (Google Cloud + Cloudflare Pages)

| Piece | Where |
|---|---|
| Sign-in | Firebase Auth (Google, email link) |
| Data | Firestore `eur3` (EU); rules in `firebase/firestore.rules` |
| API | Cloud Run `api`, europe-west1 — https://api-391833097082.europe-west1.run.app |
| Anthropic key | Secret Manager `anthropic-api-key` (only the `api-runner` service account can read it) |
| Bot check | App Check, reCAPTCHA Enterprise |
| Limits | 30 recipes/account/month, $2/day Claude budget (env vars in `scripts/deploy-api.sh`) |

One-time setup: `bash scripts/gcp-setup.sh recipe-transcriber-eu` (done). Then, after changes:

```bash
cd firebase && npx firebase deploy --only firestore:rules,firestore:indexes --project recipe-transcriber-eu
npm run deploy:api
VITE_API_BASE=https://api-391833097082.europe-west1.run.app npm run deploy:site:cloud
```

Local development against the emulators: `npm run emulators -w firebase-config`,
`npm run dev:emulators -w api`, `npm run dev:cloud:emulators -w web` (or the `rt-emulators`,
`rt-api`, `rt-cloud` launch configs). The emulator's sign-in links are listed at
http://127.0.0.1:9099/emulator/v1/projects/demo-recipe/oobCodes.

---

# Anonymous version (Cloudflare)

The hosted app is a static site on **Cloudflare Pages** (pages.dev — Hugging Face blocks downloads from *.workers.dev sites) plus a small API on **Cloudflare
Workers**. Speech-to-text runs on each visitor's device; only the transcript goes to the
Worker, which adds the operator's Anthropic key and calls Claude.

**The Anthropic API key is only ever stored as a Worker secret.** It is never in the repo,
the web build, or any `VITE_*` variable. `npm run build:hosted` fails if the bundle contains
a key or references `api.anthropic.com`.

## Limits (worker/wrangler.toml `[vars]`)

| Setting | Value |
|---|---|
| `PER_VISITOR_DAILY_LIMIT` | 20 recipes per visitor per UTC day |
| `DAILY_BUDGET_USD` | $0.50 per UTC day for everyone (Worker-enforced) |
| `EXTRACTOR_MODEL` / `VERIFIER_MODEL` | `claude-haiku-4-5` |
| Anthropic Console spend limit | **$10/month** — set by hand, the hard backstop |

## 0. Local test first

```bash
cp worker/.dev.vars.example worker/.dev.vars   # then paste YOUR key into it (gitignored)
cp web/.env.hosted.example web/.env.hosted     # public local values
npm run dev -w worker                          # Worker on http://localhost:8788
npm run preview:hosted -w web                  # app on http://localhost:5183
```

## 1. One-time account setup (the operator does these — they need your logins)

1. Create a free Cloudflare account.
2. `cd worker && npx wrangler login`
3. Cloudflare dashboard → **Turnstile** → Add widget. Hostname: `recipe-transcriber.pages.dev`
   (plus your custom domain if you add one). Note the **site key** (public) and **secret key**.
4. Set the Worker secrets — each command prompts for the value, which goes straight to
   Cloudflare:
   ```bash
   cd worker
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put VISITOR_SALT        # any long random string
   ```
5. console.anthropic.com → Limits: set a **$10/month** spend limit on the workspace whose
   key you used.

## 2. Deploy

1. Add the production origin to `ALLOWED_ORIGINS` in `worker/wrangler.toml`
   (e.g. `https://recipe-transcriber.pages.dev`), then deploy the Worker:
   ```bash
   npm run deploy:worker        # prints https://recipe-transcriber-api.<subdomain>.workers.dev
   ```
2. Build and publish the site with the PUBLIC values:
   ```bash
   VITE_API_BASE=https://recipe-transcriber-api.<subdomain>.workers.dev \
   VITE_TURNSTILE_SITE_KEY=<site key> \
   npm run deploy:site
   ```
   The script refuses non-https API URLs and Turnstile test keys.

## 3. After deploying

- Process one real clip on the live site.
- `cd worker && npx wrangler tail` shows live Worker logs (secrets are redacted).
- To pause the free service: set `DAILY_BUDGET_USD = "0"` in worker/wrangler.toml and run
  `npm run deploy:worker` (every request then gets "daily limit reached").
- To rotate the key: create a new one in the Console, `npx wrangler secret put
  ANTHROPIC_API_KEY`, then delete the old key in the Console.
