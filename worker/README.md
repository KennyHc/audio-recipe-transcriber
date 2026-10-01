# worker

Cloudflare Worker proxy for the hosted web app. It holds the operator's
Anthropic API key as a Worker secret and exposes exactly two endpoints
(`POST /extract`, `POST /verify`) built from the shared prompts/schemas with a
fixed model and hard limits, so the key can never be used for anything but
recipe extraction. See `shared/proxy.ts` for the full contract and
`CLAUDE.md` for how this fits into the rest of the app.

The key never reaches the browser, is never logged, and never appears in a
response body — see the security comments in `src/errors.ts` and the tests in
`test/index.test.ts` (`never leaks the API key`, `without leaking its
message`).

## Local development

```bash
cp .dev.vars.example .dev.vars
```

Then open `.dev.vars` and paste in your own Anthropic API key (from
<https://console.anthropic.com/settings/keys> — set a monthly spend limit on
it first, see below). `.dev.vars` is gitignored; never commit it. The other
two example values (the Turnstile always-pass test secret and a placeholder
visitor salt) are fine to use as-is for local testing.

```bash
npm run dev -w worker
```

This runs `wrangler dev`, which by default listens on **port 8787** — the
same port `server/` uses. Since you'll normally want both running side by
side, point the worker's dev server at a different port instead:

```bash
npm run dev -w worker -- --port 8788
```

The worker will then be reachable at `http://localhost:8788`. Point the
web app's hosted-mode `API_BASE` at that URL to test end to end locally (the
default `ALLOWED_ORIGINS` in `wrangler.toml` already includes
`http://localhost:5182` and `http://localhost:5183` for this).

## Tests / typecheck

```bash
npm run typecheck -w worker
npm run test -w worker
```

Tests run under plain Node (no `workerd`/Miniflare): the request-handling
logic lives in small pure modules (`src/budget.ts`, `src/cors.ts`,
`src/validation.ts`, etc.) that only ever see web-standard globals or
injected fakes (storage, `fetch`), and `src/index.ts` / `src/durableObjects/`
are thin glue over that logic, exercised with a mocked `env` (fake Durable
Object stub, fake Turnstile `fetch`, mocked Anthropic SDK).

## Deployment

One-time setup:

```bash
npx wrangler login
```

Set the three secrets (you'll be prompted to paste each value; nothing is
echoed back and nothing is written to any file in this repo):

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put VISITOR_SALT
```

`VISITOR_SALT` can be any random string you generate yourself (e.g.
`openssl rand -hex 32`) — it's only used to make the per-visitor hash
irreversible, not a credential you need to remember.

Before putting a real key in, set a **monthly spend limit** on it in the
[Anthropic Console](https://console.anthropic.com/settings/limits) — this
Worker enforces its own daily budget (`DAILY_BUDGET_USD`) and per-visitor
rate limit (`PER_VISITOR_DAILY_LIMIT`), but a spend limit on the key itself
is the backstop if those are ever misconfigured.

Then deploy:

```bash
npx wrangler deploy
```

Review `[vars]` in `wrangler.toml` (`ALLOWED_ORIGINS`,
`PER_VISITOR_DAILY_LIMIT`, `DAILY_BUDGET_USD`, `EXTRACTOR_MODEL`,
`VERIFIER_MODEL`) before deploying — in particular, update `ALLOWED_ORIGINS`
to your production web app's origin.
