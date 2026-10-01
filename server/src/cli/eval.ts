// npm run eval -w server [-- --case <name>] [-- --runs N] [-- --dry-run]
//
// --dry-run (API backend only): counts each case's extractor input tokens with the
// free token-counting endpoint and prints the input cost, without generating anything.
//
// Runs every case in eval/cases/ (or a single one with --case) through
// transcribe (if needed) -> extract -> verify -> score against its
// expected.json rubric. Cases run sequentially — the CLI backend bills the
// user's own Claude subscription, so we don't hammer it with concurrency.
//
// Results are written to eval/results/<timestamp>/ as one JSON file per
// case (or per case+run when --runs > 1) plus a summary.json. Prints a
// compact table and exits 1 if any check failed.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Recipe, Transcript, type RecipeWarning } from "@recipe/shared";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_BACKEND, EXTRACTOR_EFFORT, EXTRACTOR_MODEL, VERIFIER_MODEL } from "../config.ts";
import { costUsd, priceFor, takeUsage, type UsageRecord } from "../llm/usage.ts";
import { EXTRACTOR_SYSTEM, formatTranscriptForPrompt } from "@recipe/shared";
import { REPO_ROOT } from "../storage.ts";
import { extractRecipe, ExtractionError } from "../pipeline/extract.ts";
import { verifyRecipe, VerificationError } from "../pipeline/verify.ts";
import { transcribeAudioFile } from "../pipeline/transcribe.ts";
import { Rubric } from "../eval/rubric.ts";
import { scoreRecipe, type CaseScore } from "../eval/score.ts";

const EVAL_ROOT = path.join(REPO_ROOT, "eval");
const CASES_ROOT = path.join(EVAL_ROOT, "cases");

interface CliArgs {
  case?: string;
  runs: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { runs: 1, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") {
      args.dryRun = true;
    } else if (argv[i] === "--case") {
      args.case = argv[++i];
    } else if (argv[i] === "--runs") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`--runs must be a positive integer, got "${argv[i]}"`);
      }
      args.runs = n;
    } else {
      throw new Error(`Unknown argument "${argv[i]}". Usage: npm run eval -w server -- [--case <name>] [--runs N] [--dry-run]`);
    }
  }
  return args;
}

async function listCaseNames(): Promise<string[]> {
  const entries = await readdir(CASES_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Finds a case folder's source audio file (any extension, excluding the generated .wav). */
async function findCaseAudio(caseDir: string): Promise<string | null> {
  if (!existsSync(caseDir)) return null;
  const entries = await readdir(caseDir);
  const match = entries.find((name) => name.startsWith("audio.") && !name.endsWith(".wav"));
  return match ? path.join(caseDir, match) : null;
}

/** Loads eval/cases/<name>/transcript.json, transcribing from audio.* and caching it if missing. */
async function loadOrTranscribe(caseName: string, caseDir: string): Promise<Transcript> {
  const transcriptPath = path.join(caseDir, "transcript.json");
  if (existsSync(transcriptPath)) {
    const raw = JSON.parse(await readFile(transcriptPath, "utf-8"));
    const parsed = Transcript.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${transcriptPath} is not a valid Transcript: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  const audioPath = await findCaseAudio(caseDir);
  if (!audioPath) {
    throw new Error(`Case "${caseName}" has neither transcript.json nor an audio.* file in ${caseDir}`);
  }

  console.log(`  [${caseName}] no transcript.json — transcribing ${path.basename(audioPath)}...`);
  const transcript = await transcribeAudioFile(audioPath, caseDir);
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2), "utf-8");
  return transcript;
}

async function loadRubric(caseName: string, caseDir: string): Promise<Rubric> {
  const expectedPath = path.join(caseDir, "expected.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(expectedPath, "utf-8"));
  } catch (err) {
    throw new Error(`Case "${caseName}" is missing a readable expected.json: ${err instanceof Error ? err.message : err}`);
  }
  const parsed = Rubric.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${expectedPath} is not a valid Rubric: ${parsed.error.message}`);
  }
  return parsed.data;
}

interface CaseResult {
  case: string;
  run: number;
  recipe: Recipe;
  score: CaseScore;
  durationMs: number;
  backend: string;
  models: { extractor: string; verifier: string };
  usage: UsageRecord[];
  costUsd: number | null;
}

async function runCaseOnce(caseName: string, caseDir: string, run: number): Promise<CaseResult> {
  const transcript = await loadOrTranscribe(caseName, caseDir);
  const rubric = await loadRubric(caseName, caseDir);

  takeUsage(); // discard anything left over from a failed previous run
  const start = Date.now();
  const extracted = await extractRecipe(transcript);

  let warnings: RecipeWarning[];
  try {
    warnings = await verifyRecipe(transcript, extracted);
  } catch (err) {
    const message = err instanceof VerificationError ? err.message : String(err);
    warnings = [
      {
        kind: "other",
        message: `Verification could not run: ${message}`,
        target: null,
        suggestion: null,
      },
    ];
  }
  const durationMs = Date.now() - start;

  const recipe: Recipe = { ...extracted, warnings };
  const score = scoreRecipe(recipe, rubric);
  const usage = takeUsage();

  return {
    case: caseName,
    run,
    recipe,
    score,
    durationMs,
    backend: CLAUDE_BACKEND,
    models: { extractor: EXTRACTOR_MODEL, verifier: VERIFIER_MODEL },
    usage,
    costUsd: usage.length > 0 ? costUsd(usage) : null,
  };
}

function formatCost(usd: number | null): string {
  return usd === null ? "-" : `$${usd.toFixed(4)}`;
}

async function dryRun(caseNames: string[]): Promise<void> {
  const client = new Anthropic();
  const price = priceFor(EXTRACTOR_MODEL);
  console.log(`Dry run: extractor input tokens (${EXTRACTOR_MODEL}), counted for free.\n`);
  for (const caseName of caseNames) {
    const transcriptPath = path.join(CASES_ROOT, caseName, "transcript.json");
    if (!existsSync(transcriptPath)) {
      console.log(`${caseName}: no transcript.json yet (would need transcription first)`);
      continue;
    }
    const transcript = Transcript.parse(JSON.parse(await readFile(transcriptPath, "utf-8")));
    const { input_tokens } = await client.messages.countTokens({
      model: EXTRACTOR_MODEL,
      system: EXTRACTOR_SYSTEM,
      messages: [{ role: "user", content: formatTranscriptForPrompt(transcript) }],
    });
    const inputCost = price ? (input_tokens * price.input) / 1_000_000 : null;
    console.log(`${caseName.padEnd(44)} ${String(input_tokens).padStart(6)} input tokens  ~${formatCost(inputCost)} input`);
  }
  console.log("\nOutput (recipe JSON + thinking) and the verifier call come on top; a real run reports exact totals.");
}

function resultFileName(caseName: string, run: number, totalRuns: number): string {
  return totalRuns > 1 ? `${caseName}.run${run}.json` : `${caseName}.json`;
}

function pct(score: CaseScore): string {
  return `${Math.round(score.score * 100)}%`;
}

function printTable(results: CaseResult[]): void {
  const headers = ["case", "run", "score", "passed/total", "duration", "tokens in/out", "cost"];
  const rows = results.map((r) => [
    r.case,
    String(r.run),
    pct(r.score),
    `${r.score.passed}/${r.score.total}`,
    `${(r.durationMs / 1000).toFixed(1)}s`,
    r.usage.length > 0
      ? `${r.usage.reduce((n, u) => n + u.inputTokens, 0)}/${r.usage.reduce((n, u) => n + u.outputTokens, 0)}`
      : "-",
    formatCost(r.costUsd),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");

  console.log("");
  console.log(fmt(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(fmt(row));
}

function printFailures(results: CaseResult[]): void {
  const withFailures = results.filter((r) => r.score.checks.some((c) => !c.pass));
  if (withFailures.length === 0) return;

  console.log("\nFailed checks:");
  for (const r of withFailures) {
    for (const check of r.score.checks) {
      if (check.pass) continue;
      console.log(`  [${r.case} run ${r.run}] ${check.name}: ${check.detail}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (CLAUDE_BACKEND === "api" && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      "CLAUDE_BACKEND=api but ANTHROPIC_API_KEY is not set. Set it in .env, or use CLAUDE_BACKEND=cli.",
    );
    process.exit(1);
  }

  const allCaseNames = await listCaseNames();
  let caseNames = allCaseNames;
  if (args.case) {
    if (!allCaseNames.includes(args.case)) {
      console.error(`No case named "${args.case}" in ${CASES_ROOT}. Available: ${allCaseNames.join(", ")}`);
      process.exit(1);
    }
    caseNames = [args.case];
  }

  if (args.dryRun) {
    if (CLAUDE_BACKEND !== "api") {
      console.error("--dry-run needs CLAUDE_BACKEND=api (it uses the API's free token counter).");
      process.exit(1);
    }
    await dryRun(caseNames);
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = path.join(EVAL_ROOT, "results", timestamp);
  await mkdir(resultsDir, { recursive: true });

  console.log(
    `Running ${caseNames.length} case(s) x ${args.runs} run(s), backend=${CLAUDE_BACKEND}, ` +
      `extractor=${EXTRACTOR_MODEL}${EXTRACTOR_MODEL.startsWith("claude-haiku-4-5") ? "" : ` (effort ${EXTRACTOR_EFFORT})`}, verifier=${VERIFIER_MODEL}`,
  );

  const results: CaseResult[] = [];
  let anyFailed = false;

  for (const caseName of caseNames) {
    const caseDir = path.join(CASES_ROOT, caseName);
    for (let run = 1; run <= args.runs; run++) {
      let result: CaseResult;
      try {
        result = await runCaseOnce(caseName, caseDir, run);
      } catch (err) {
        anyFailed = true;
        const message =
          err instanceof ExtractionError
            ? `Extraction failed: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        console.error(`[${caseName} run ${run}] ${message}`);
        continue;
      }

      results.push(result);
      if (result.score.checks.some((c) => !c.pass)) anyFailed = true;

      const fileName = resultFileName(caseName, run, args.runs);
      await writeFile(
        path.join(resultsDir, fileName),
        JSON.stringify(
          {
            recipe: result.recipe,
            score: result.score,
            durationMs: result.durationMs,
            backend: result.backend,
            models: result.models,
            usage: result.usage,
            costUsd: result.costUsd,
          },
          null,
          2,
        ),
        "utf-8",
      );
    }
  }

  printTable(results);
  printFailures(results);

  const totalPassed = results.reduce((sum, r) => sum + r.score.passed, 0);
  const totalChecks = results.reduce((sum, r) => sum + r.score.total, 0);
  const overallPct = totalChecks === 0 ? 0 : Math.round((totalPassed / totalChecks) * 100);
  console.log(
    `\nOverall: ${totalPassed}/${totalChecks} checks passed (${overallPct}%) across ${results.length} run(s).`,
  );
  const costs = results.map((r) => r.costUsd);
  if (costs.length > 0 && costs.every((c) => c !== null)) {
    const total = costs.reduce<number>((a, c) => a + (c ?? 0), 0);
    console.log(`API cost: ${formatCost(total)} total, ${formatCost(total / costs.length)} per recipe.`);
  }

  const summary = {
    timestamp,
    backend: CLAUDE_BACKEND,
    models: { extractor: EXTRACTOR_MODEL, verifier: VERIFIER_MODEL },
    runs: args.runs,
    cases: results.map((r) => ({
      case: r.case,
      run: r.run,
      score: r.score.score,
      passed: r.score.passed,
      total: r.score.total,
      durationMs: r.durationMs,
      costUsd: r.costUsd,
      failedChecks: r.score.checks.filter((c) => !c.pass).map((c) => ({ name: c.name, detail: c.detail })),
    })),
    totalPassed,
    totalChecks,
    overallScore: totalChecks === 0 ? 0 : totalPassed / totalChecks,
  };
  await writeFile(path.join(resultsDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\nResults written to ${path.relative(REPO_ROOT, resultsDir)}/`);

  if (anyFailed) process.exit(1);
}

void main();
