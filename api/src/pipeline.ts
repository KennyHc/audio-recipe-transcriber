/**
 * Extract + verify one transcript under the global daily budget — the server-side
 * equivalent of web/src/backend/browser/runner.ts extractVerifyAndSave (minus the save):
 * extraction failure fails the request; verification failure is downgraded to a single
 * "other" warning so the user still gets their recipe.
 */
import {
  finalizeWarnings,
  normalizeExtractedRecipe,
  stripTimestampsIfUntimed,
  type Recipe,
  type RecipeWarning,
  type Transcript,
} from "@recipe/shared";
import type { Firestore } from "firebase-admin/firestore";
import { releaseReservation, reserveBudgetOrThrow, settleReservation } from "./budget";
import { ClaudeOutputError, type ClaudeResult, type ClaudeService, EXTRACT_MAX_TOKENS, VERIFY_MAX_TOKENS } from "./claude/types";
import type { Config } from "./config";
import { actualCostUsd, estimateMaxCostUsd } from "./cost";
import { AppError, appError, sanitizedErrorLog } from "./errors";
import type { Logger } from "./log";
import { transcriptChars } from "./validation";

export interface PipelineDeps {
  db: Firestore;
  claude: ClaudeService;
  config: Config;
  now: () => Date;
  logger: Logger;
}

export async function extractAndVerify(deps: PipelineDeps, transcript: Transcript): Promise<Recipe> {
  const chars = transcriptChars(transcript);
  const raw = await budgetedCall(deps, "extract", deps.config.extractorModel, chars, EXTRACT_MAX_TOKENS, () =>
    deps.claude.extract(transcript),
  );
  // Pasted plain-text captions have no timing: drop the "0:00" timestamps the model copied.
  const extracted = stripTimestampsIfUntimed(normalizeExtractedRecipe(raw), transcript);

  let warnings: RecipeWarning[];
  try {
    const rawWarnings = await budgetedCall(deps, "verify", deps.config.verifierModel, chars, VERIFY_MAX_TOKENS, () =>
      deps.claude.verify(transcript, extracted),
    );
    warnings = finalizeWarnings(extracted, rawWarnings);
  } catch (err) {
    warnings = [
      {
        kind: "other",
        message: `Verification could not run: ${verifyFailureReason(err)}`,
        target: null,
        suggestion: null,
      },
    ];
  }
  return { ...extracted, warnings };
}

/** User-safe reason (never the SDK's text) for the "Verification could not run" warning. */
function verifyFailureReason(err: unknown): string {
  if (err instanceof AppError && err.code === "budget_exhausted") {
    return "the service reached its daily usage cap. Re-extract later to check this recipe.";
  }
  return "the checking service had a problem. Re-extract to try again.";
}

/**
 * Reserve worst-case cost → call → settle to the actual cost. On failure: settle with the
 * billed usage if a response came back (ClaudeOutputError), else release. Bookkeeping
 * failures after the fact are logged, not surfaced: a stuck reservation only makes the cap
 * more conservative until the day ends.
 */
export async function budgetedCall<T>(
  deps: PipelineDeps,
  stage: "extract" | "verify" | "screen" | "suggest",
  model: string,
  inputChars: number,
  maxTokens: number,
  call: () => Promise<ClaudeResult<T>>,
): Promise<T> {
  const { db, config, logger } = deps;
  const reservation = await reserveBudgetOrThrow(
    db,
    estimateMaxCostUsd(model, inputChars, maxTokens),
    config.dailyBudgetUsd,
    deps.now(),
  );

  let result: ClaudeResult<T>;
  try {
    result = await call();
  } catch (err) {
    const bookkeeping =
      err instanceof ClaudeOutputError
        ? settleReservation(db, reservation, actualCostUsd(model, err.usage))
        : releaseReservation(db, reservation);
    await bookkeeping.catch((e: unknown) => logBudgetError(deps, e));
    if (err instanceof AppError) {
      logger.log("WARNING", "claude call unusable", { stage, code: err.code });
      throw err;
    }
    logger.log("ERROR", "claude call failed", { stage, error: sanitizedErrorLog(err, [config.anthropicApiKey]) });
    throw appError("upstream_error");
  }

  const costUsd = actualCostUsd(model, result.usage);
  await settleReservation(db, reservation, costUsd).catch((e: unknown) => logBudgetError(deps, e));
  logger.log("INFO", "claude call", {
    stage,
    model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: Number(costUsd.toFixed(6)),
  });
  return result.output;
}

function logBudgetError(deps: PipelineDeps, err: unknown): void {
  deps.logger.log("ERROR", "budget bookkeeping failed", {
    error: sanitizedErrorLog(err, [deps.config.anthropicApiKey]),
  });
}
