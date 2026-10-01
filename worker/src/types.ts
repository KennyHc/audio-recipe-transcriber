/** Bindings and vars declared in wrangler.toml. */
export interface Env {
  LIMITER: DurableObjectNamespace;

  // [vars] — plain config, not secret.
  ALLOWED_ORIGINS: string;
  PER_VISITOR_DAILY_LIMIT: string;
  DAILY_BUDGET_USD: string;
  EXTRACTOR_MODEL: string;
  VERIFIER_MODEL: string;

  // Secrets — set via `npx wrangler secret put <NAME>` (prod) or `.dev.vars`
  // (local, gitignored). Never logged, never echoed in a response body.
  ANTHROPIC_API_KEY: string;
  TURNSTILE_SECRET: string;
  VISITOR_SALT: string;
}
