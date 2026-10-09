// Cloud mode's finish step for the shared in-browser runner (browser/runner.ts setFinishStep):
// once Whisper has saved the transcript locally, send it to the API (POST /recipes), which
// extracts + verifies + saves the recipe in the account. Then the local job record goes away —
// the recipe lives in Firestore now — but the audio stays on this device under the same id, so
// click-to-hear keeps working here.
//
// On failure the error propagates: the runner marks the local job "error" with the (already
// friendly) message and the transcript stays local, so Retry re-POSTs without transcribing again.

import type { CloudRecipe, Usage } from "@recipe/shared";
import type { FinishStep } from "../browser/runner";
import * as db from "../browser/db";
import type { ApiClient } from "./api";
import { forgetLocalJob } from "./localJobs";

export interface CloudFinishDeps {
  api: Pick<ApiClient, "createRecipe">;
  requireUid(): Promise<string>;
  /** The recipe the API just saved (warms the library cache). */
  onRecipeSaved(uid: string, recipe: CloudRecipe): void;
  onUsage(usage: Usage): void;
}

export const MAKING_RECIPE_LABEL = "Making your recipe";

export function createCloudFinish(deps: CloudFinishDeps): FinishStep {
  return async (jobId, _source, ctx) => {
    const uid = await deps.requireUid();
    const job = await db.getJob(jobId);
    if (!job) throw new Error("Job not found.");
    const transcript = await db.getTranscript(jobId);
    if (!transcript) throw new Error("No transcript to make a recipe from — press Retry to transcribe again.");
    if (transcript.segments.length === 0) {
      throw new Error("No speech was found in this recording.");
    }

    await ctx.setStage("extracting", MAKING_RECIPE_LABEL);
    const res = await deps.api.createRecipe({
      id: jobId,
      fileName: job.fileName.slice(0, 300),
      transcript,
    });

    deps.onRecipeSaved(uid, res.recipe);
    deps.onUsage(res.usage);
    await db.deleteJobRecord(jobId, { keepAudio: true });
    forgetLocalJob(jobId);
  };
}
