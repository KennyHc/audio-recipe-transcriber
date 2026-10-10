/**
 * POST /recipes/:id/publish/suggestions — tags + a wrong-link check for the Publish dialog
 * (shared/public.ts). Advisory: after the owner check and the daily limit, every failure
 * (oEmbed, budget, Claude) degrades to empty suggestions instead of an error, because the
 * dialog must work without them and screening still runs on publish.
 */
import {
  ALL_TAGS,
  formatPublishAssistInput,
  MAX_SUGGESTIONS_PER_DAY,
  MAX_TAGS,
  PUBLISH_ASSIST_SYSTEM,
  PublishAssistOutput,
  type PublishSuggestionsRequest,
  type PublishSuggestionsResponse,
  RecipeDoc,
} from "@recipe/shared";
import type { DecodedIdToken } from "firebase-admin/auth";
import { profileFromToken } from "./auth";
import { SUGGEST_MAX_TOKENS } from "./claude/types";
import { AppError, appError } from "./errors";
import { budgetedCall } from "./pipeline";
import type { PublicDeps } from "./publish";
import { userRef } from "./publish";
import { countUserActionOrThrow, writeUserFields } from "./ratelimit";
import { recipeRef } from "./recipes";
import { lookupSource } from "./sources";
import { RECIPE_ID_PATTERN } from "./validation";

const NONE: PublishSuggestionsResponse = { tags: [], creditWarning: null };

export async function publishSuggestions(
  deps: PublicDeps,
  user: DecodedIdToken,
  id: string,
  body: PublishSuggestionsRequest,
): Promise<PublishSuggestionsResponse> {
  const { db } = deps;
  if (!RECIPE_ID_PATTERN.test(id)) throw appError("not_found");
  const snap = await recipeRef(db, id).get();
  const recipe = snap.exists ? RecipeDoc.safeParse(snap.data()) : null;
  if (!recipe?.success || recipe.data.ownerId !== user.uid) throw appError("not_found");

  await countSuggestion(deps, user);

  // The video's own title/channel (oEmbed); "other" links and lookup failures → no video.
  let video: { title: string | null; channelName: string | null } | null = null;
  if (body.sourceUrl) {
    try {
      const { link, credit } = await lookupSource(deps.fetch, body.sourceUrl);
      if (link.platform !== "other") video = { title: credit.title, channelName: credit.channelName };
    } catch {
      video = null;
    }
  }

  const message = formatPublishAssistInput({ recipe: recipe.data.latest, video });
  try {
    const raw = await budgetedCall(
      deps,
      "suggest",
      deps.config.screeningModel,
      message.length + PUBLISH_ASSIST_SYSTEM.length,
      SUGGEST_MAX_TOKENS,
      () => deps.claude.suggest(message),
    );
    const parsed = PublishAssistOutput.safeParse(raw);
    if (!parsed.success) return NONE;
    return toResponse(parsed.data, video !== null);
  } catch (err) {
    deps.logger.log("WARNING", "publish suggestions unavailable", {
      code: err instanceof AppError ? err.code : "invalid_output",
    });
    return NONE;
  }
}

/** Keeps only known tag ids (deduped, ≤ MAX_TAGS); a credit note only for a real video. */
export function toResponse(output: PublishAssistOutput, hasVideo: boolean): PublishSuggestionsResponse {
  const tags = [...new Set(output.tags.map((t) => t.trim().toLowerCase()))]
    .filter((t) => ALL_TAGS.includes(t))
    .slice(0, MAX_TAGS);
  const note = output.creditNote?.trim();
  const creditWarning = hasVideo && !output.creditMatches && note ? note.slice(0, 300) : null;
  return { tags, creditWarning };
}

async function countSuggestion(deps: PublicDeps, user: DecodedIdToken): Promise<void> {
  const { db } = deps;
  const ref = userRef(db, user.uid);
  const now = deps.now();
  await db.runTransaction(async (tx) => {
    const uSnap = await tx.get(ref);
    const state = countUserActionOrThrow(uSnap, "suggestions", MAX_SUGGESTIONS_PER_DAY, now);
    writeUserFields(tx, ref, uSnap, profileFromToken(user), now, { counter: { name: "suggestions", state } });
  });
}
