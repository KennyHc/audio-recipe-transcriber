#!/usr/bin/env node
// Guards the built bundle against the one thing hosted mode must never leak: an Anthropic API
// key. Scans web/dist for the `sk-ant-` key prefix (real or accidentally-embedded) and, in
// `--hosted` mode, also fails if the literal string "api.anthropic.com" shows up anywhere —
// a hosted build should never talk to Anthropic directly, only to the operator's Worker (see
// shared/proxy.ts). The BYOK browser build legitimately calls api.anthropic.com from
// backend/browser/claude.ts, so that check only runs with --hosted.
//
// Run automatically at the end of `npm run build:hosted` and `npm run build:cloud` (see
// web/package.json) — cloud mode is held to the same rule: Claude is only reached via the API. Exits 1 and
// prints every offending file/match on failure; prints a one-line PASS and exits 0 otherwise.
//
// Flags:
//   --hosted        also fail on any "api.anthropic.com" reference (see above)
//   --cloud         same check as --hosted, labelled for the signed-in cloud build; also fails
//                   when VITE_CONTACT_EMAIL (the Terms/Privacy contact) is empty — resolved like
//                   Vite does for `--mode cloud`: process env, then .env.cloud.local, .env.cloud,
//                   .env.local, .env
//   --dir <path>    scan this directory instead of web/dist (used by check-no-secrets.test.ts
//                   to point at temp-dir fixtures without touching a real build)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST_DIR = resolve(__dirname, "..", "dist");
const WEB_DIR = resolve(__dirname, "..");

/** Variables a cloud build must have non-empty (public values baked into the bundle). */
export const REQUIRED_CLOUD_ENV = ["VITE_CONTACT_EMAIL"];

/** Minimal dotenv parsing (KEY=value, optional quotes, # comments) — enough for web/.env*. */
export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    out[m[1]] = value;
  }
  return out;
}

/**
 * The value Vite would use for `name` in `mode`: an existing process env var wins, then
 * .env.[mode].local, .env.[mode], .env.local, .env (in `dir`). "" when unset.
 */
export function resolveViteEnv(name, { mode, dir = WEB_DIR, env = process.env } = {}) {
  if (env[name] !== undefined) return String(env[name]).trim();
  for (const file of [`.env.${mode}.local`, `.env.${mode}`, ".env.local", ".env"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const vars = parseDotenv(readFileSync(path, "utf8"));
    if (vars[name] !== undefined) return vars[name].trim();
  }
  return "";
}

/** Names of required cloud variables that are empty. */
export function missingCloudEnv(options) {
  return REQUIRED_CLOUD_ENV.filter((name) => !resolveViteEnv(name, { mode: "cloud", ...options }));
}

// Only scan text-ish output files; skip binaries (fonts, images) where these patterns can't
// meaningfully appear and reading them as UTF-8 would just produce noise.
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".html", ".css", ".json", ".map", ".txt", ".svg"]);

export const SECRET_KEY_PATTERN = /sk-ant-[a-zA-Z0-9_-]{8,}/g;
export const ANTHROPIC_HOST_PATTERN = /api\.anthropic\.com/g;

/** Recursively collects every text file under `dir`. */
export function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (TEXT_EXTENSIONS.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scans every text file under `scanDir` and returns a findings array (empty = clean). Pure
 * function (no process.exit/console) so it can be unit-tested directly against temp fixtures.
 */
export function scan(scanDir, { hostedMode }) {
  const files = collectFiles(scanDir);
  const findings = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const relPath = file.slice(scanDir.length + 1);

    const keyMatches = text.match(SECRET_KEY_PATTERN);
    if (keyMatches) {
      findings.push(`${relPath}: contains what looks like an Anthropic API key (${keyMatches[0].slice(0, 12)}…)`);
    }

    if (hostedMode) {
      const hostMatches = text.match(ANTHROPIC_HOST_PATTERN);
      if (hostMatches) {
        findings.push(
          `${relPath}: contains "api.anthropic.com" — a hosted build must only call the Worker (VITE_API_BASE), never Anthropic directly`,
        );
      }
    }
  }

  return { files, findings };
}

function parseArgs(argv) {
  const cloud = argv.includes("--cloud");
  const hostedMode = argv.includes("--hosted") || cloud;
  const dirFlagIndex = argv.indexOf("--dir");
  const dir = dirFlagIndex !== -1 ? argv[dirFlagIndex + 1] : undefined;
  return { cloud, hostedMode, label: cloud ? "cloud" : hostedMode ? "hosted" : "default", dir: dir ? resolve(dir) : DEFAULT_DIST_DIR };
}

function main() {
  const { cloud, hostedMode, label, dir } = parseArgs(process.argv.slice(2));

  if (cloud) {
    const missing = missingCloudEnv();
    if (missing.length > 0) {
      console.error(
        `check-no-secrets: FAILED (cloud mode) — ${missing.join(", ")} is empty. Set it in web/.env.cloud.local (see web/.env.cloud.example).`,
      );
      process.exit(1);
      return;
    }
  }

  let distStat;
  try {
    distStat = statSync(dir);
  } catch {
    console.error(`check-no-secrets: ${dir} does not exist — run the build first.`);
    process.exit(1);
    return;
  }
  if (!distStat.isDirectory()) {
    console.error(`check-no-secrets: ${dir} is not a directory.`);
    process.exit(1);
    return;
  }

  const { files, findings } = scan(dir, { hostedMode });

  if (findings.length > 0) {
    console.error(`check-no-secrets: FAILED (${label} mode, ${files.length} files scanned)\n`);
    for (const f of findings) console.error(`  - ${f}`);
    process.exit(1);
    return;
  }

  const checkedFor = hostedMode
    ? "no key and no api.anthropic.com reference found"
    : "no key found (api.anthropic.com check skipped — pass --hosted to enable it)";
  console.log(`check-no-secrets: PASS (${label} mode, ${files.length} files scanned, ${checkedFor})`);
}

// Only run as a CLI when executed directly (not when imported by check-no-secrets.test.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
