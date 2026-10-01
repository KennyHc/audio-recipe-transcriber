# Deploying the hosted app (Cloudflare)

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
