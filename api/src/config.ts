import { DEFAULT_DAILY_BUDGET_USD, FREE_MONTHLY_RECIPES } from "@recipe/shared";

export interface Config {
  anthropicApiKey: string;
  extractorModel: string;
  verifierModel: string;
  /** Publish screening (Phase 2); counts toward the daily budget, not the user's quota. */
  screeningModel: string;
  dailyBudgetUsd: number;
  freeMonthlyRecipes: number;
  allowedOrigins: string[];
  requireAppCheck: boolean;
  /**
   * Salt for hashing reporter IPs (per-IP report rate limit) — the raw IP is never stored.
   * Required in production (Secret Manager `report-salt`); a fixed dev value on emulators.
   */
  reportSalt: string;
}

/** Thrown at startup; the message names the variable but never echoes its value. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_ORIGINS = ["https://recipe-transcriber.pages.dev"];
/** Emulator-only fallback for REPORT_SALT (local data, nothing to protect). */
const DEV_REPORT_SALT = "dev-report-salt-emulator-only";
/** Vite dev/preview ports (web/package.json), allowed only when running against emulators. */
const DEV_ORIGINS = [5180, 5181, 5182, 5183, 5184].map((p) => `http://localhost:${p}`);

type Env = Record<string, string | undefined>;

/**
 * Fail closed (like the Worker's assertConfiguredOrThrow): refuse to start if the key is
 * missing or a limit isn't a valid number. A mistyped DAILY_BUDGET_USD would otherwise
 * become NaN, and `x > NaN` is always false — silently disabling the cap.
 */
export function loadConfig(env: Env): Config {
  const emulator = isSet(env.FIRESTORE_EMULATOR_HOST);

  const anthropicApiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
  if (!anthropicApiKey) throw new ConfigError("ANTHROPIC_API_KEY is not set");

  const requireAppCheck = parseBool(env.REQUIRE_APP_CHECK, true, "REQUIRE_APP_CHECK");
  if (!requireAppCheck && !emulator) {
    // App Check is our main abuse guard; it may only be off for local emulator runs.
    throw new ConfigError("REQUIRE_APP_CHECK=false is only allowed with FIRESTORE_EMULATOR_HOST set");
  }

  const reportSalt = (env.REPORT_SALT ?? "").trim() || (emulator ? DEV_REPORT_SALT : "");
  if (!reportSalt) throw new ConfigError("REPORT_SALT is not set");

  const configuredOrigins = isSet(env.ALLOWED_ORIGINS)
    ? env
        .ALLOWED_ORIGINS!.split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : DEFAULT_ORIGINS;
  const allowedOrigins = emulator ? [...new Set([...configuredOrigins, ...DEV_ORIGINS])] : configuredOrigins;

  const config: Config = {
    anthropicApiKey,
    extractorModel: nonEmptyOr(env.EXTRACTOR_MODEL, DEFAULT_MODEL),
    verifierModel: nonEmptyOr(env.VERIFIER_MODEL, DEFAULT_MODEL),
    screeningModel: nonEmptyOr(env.SCREENING_MODEL, DEFAULT_MODEL),
    dailyBudgetUsd: parseNumber(env.DAILY_BUDGET_USD, DEFAULT_DAILY_BUDGET_USD, "DAILY_BUDGET_USD"),
    freeMonthlyRecipes: parseNumber(env.FREE_MONTHLY_RECIPES, FREE_MONTHLY_RECIPES, "FREE_MONTHLY_RECIPES"),
    allowedOrigins,
    requireAppCheck,
    reportSalt,
  };
  assertValidConfig(config);
  return config;
}

/** Also called by createApp, so a hand-built config (tests, future wiring) is held to the same bar. */
export function assertValidConfig(config: Config): void {
  if (!config.anthropicApiKey.trim()) throw new ConfigError("anthropicApiKey is empty");
  if (!config.extractorModel || !config.verifierModel || !config.screeningModel) {
    throw new ConfigError("model name is empty");
  }
  if (!config.reportSalt.trim()) throw new ConfigError("reportSalt is empty");
  if (!Number.isFinite(config.dailyBudgetUsd) || config.dailyBudgetUsd < 0) {
    throw new ConfigError("DAILY_BUDGET_USD must be a non-negative number");
  }
  if (!Number.isInteger(config.freeMonthlyRecipes) || config.freeMonthlyRecipes < 0) {
    throw new ConfigError("FREE_MONTHLY_RECIPES must be a non-negative integer");
  }
  if (config.allowedOrigins.length === 0) throw new ConfigError("ALLOWED_ORIGINS is empty");
  for (const origin of config.allowedOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
      throw new ConfigError("ALLOWED_ORIGINS entries must look like https://host[:port] (no path)");
    }
  }
}

function isSet(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyOr(value: string | undefined, fallback: string): string {
  return isSet(value) ? value.trim() : fallback;
}

function parseNumber(value: string | undefined, fallback: number, name: string): number {
  if (!isSet(value)) return fallback;
  const n = Number(value.trim());
  if (!Number.isFinite(n)) throw new ConfigError(`${name} is not a number`);
  return n;
}

function parseBool(value: string | undefined, fallback: boolean, name: string): boolean {
  if (!isSet(value)) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  throw new ConfigError(`${name} must be "true" or "false"`);
}
