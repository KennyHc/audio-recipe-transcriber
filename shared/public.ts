import { z } from "zod";
import { CloudRecipe } from "./cloud";
import { Recipe } from "./recipe";

// Phase 2 contract: publishing + the public recipe bank. See PHASE2-PLAN.md and the credit
// policy in SAAS-PLAN.md §6.1. Builds on shared/cloud.ts (same auth headers, CloudError).
//
// Who writes what:
//   - Only the API writes publicRecipes/*, handles/*, sources/*, users/{uid}/saves|likes/*,
//     reports/*, and stats. Credit comes from oEmbed on the server, so it can't be faked.
//   - Anyone (signed out too) reads live public recipes; lists must filter
//     status == "live" && visibility == "public". Owners and admins can read their own
//     non-live ones. Transcripts, audio, and version history are never public.
//   - A private recipe can't be deleted while it's published (rules check), so the web
//     client calls DELETE /recipes/:id/publish first.
//
// HTTP API (headers as in cloud.ts; "public" routes need only App Check when signed out):
//   GET    /sources/preview?url=…        -> SourcePreview      signed in
//          Identifies the platform/video and fetches the credit via oEmbed, for the dialog.
//   POST   /recipes/:id/publish          PublishRequest -> PublishResponse   owner
//          First publish or "Update public version" (re-snapshots the private latest).
//          Screens the text with Haiku (global budget, not the user's quota); flagged ->
//          status "review". 409 duplicate_video / handle_taken; 422 source_unavailable;
//          429 rate_limited (MAX_PUBLISHES_PER_DAY).
//   POST   /recipes/:id/publish/suggestions  PublishSuggestionsRequest
//                                         -> PublishSuggestionsResponse   owner
//          For the Publish dialog: suggested tags, and a warning if the video link doesn't
//          look like this recipe (wrong link). One Haiku call under the global budget;
//          fails soft (empty suggestions, 200) — publishing never depends on it.
//          Rate limit MAX_SUGGESTIONS_PER_DAY.
//   DELETE /recipes/:id/publish                               -> 204   owner (or admin)
//   POST   /public/:id/like | DELETE      -> EngagementResponse         signed in
//   POST   /public/:id/save | DELETE      -> EngagementResponse         signed in
//   POST   /public/:id/copy               -> CopyResponse               signed in
//          A private copy in the caller's library (forkedFrom), no Claude, no quota.
//   POST   /public/:id/report  ReportRequest -> 202                    App Check only
//   GET    /admin/queue                   -> AdminQueueResponse         admin claim
//   POST   /admin/public/:id   AdminActionRequest -> 204               admin claim
//   DELETE /me (extended): also unpublishes, frees the handle, removes saves/likes and
//          decrements their counts.

// ---------------------------------------------------------------------------
// Firestore layout
// ---------------------------------------------------------------------------

export const PUBLIC_COLLECTIONS = {
  publicRecipes: "publicRecipes", // doc id = the private recipe id
  handles: "handles", // doc id = handle
  sources: "sources", // doc id = sourceKey(platform, videoId)
  saves: "saves", // users/{uid}/saves/{publicId}
  likes: "likes", // users/{uid}/likes/{publicId}
  reports: "reports",
} as const;

export const sourceKey = (platform: string, videoId: string) => `${platform}:${videoId}`;

/** 3–20 chars, lowercase letters, digits, underscore; shown as "@handle". Fixed once chosen. */
export const Handle = z.string().regex(/^[a-z0-9_]{3,20}$/);
export type Handle = z.infer<typeof Handle>;

export const PublicVisibility = z.enum(["public", "unlisted"]);
export type PublicVisibility = z.infer<typeof PublicVisibility>;

export const PublicStatus = z.enum([
  "live", // visible (public: in Explore; unlisted: by link)
  "review", // flagged by screening; only the owner and admins see it
  "hidden", // hidden by an admin (report/claim); only the owner and admins see it
]);
export type PublicStatus = z.infer<typeof PublicStatus>;

export const SourcePlatform = z.enum(["youtube", "tiktok", "other"]);
export type SourcePlatform = z.infer<typeof SourcePlatform>;

/** Credit as stored and shown. For youtube/tiktok every field comes from oEmbed. */
export const RecipeSource = z.object({
  kind: z.enum(["video", "own", "other"]),
  platform: SourcePlatform.nullable(), // null for "own"
  videoId: z.string().nullable(), // youtube/tiktok only
  url: z.string().nullable(), // canonical link to the original
  title: z.string().nullable(), // video/page title
  channelName: z.string().nullable(), // "Recipe by {channelName}"
  channelUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(), // also the link-preview image
  /** Where the uploaded clip starts in the original video; timestamps seek to offset + t. */
  startOffsetSeconds: z.number().int().min(0),
});
export type RecipeSource = z.infer<typeof RecipeSource>;

export const PublicStats = z.object({
  saves: z.number().int(),
  likes: z.number().int(),
  score: z.number().int(), // likes + 2 × saves — "Popular" sorts by this
});
export type PublicStats = z.infer<typeof PublicStats>;

export const popularityScore = (s: { saves: number; likes: number }) => s.likes + 2 * s.saves;

/** publicRecipes/{id} */
export const PublicRecipeDoc = z.object({
  ownerId: z.string(),
  handle: Handle, // "Transcribed by @handle"
  visibility: PublicVisibility,
  status: PublicStatus,
  recipe: Recipe, // snapshot of the private latest at publish/update time
  sourceVersion: z.number().int(), // private version number that was snapshotted
  source: RecipeSource,
  tags: z.array(z.string()), // ids from TAGS
  terms: z.array(z.string()), // searchTerms(recipe, tags)
  stats: PublicStats,
  publishedAt: z.string(), // ISO; first publish
  updatedAt: z.string(), // ISO; last publish/update
  /**
   * Why screening held it (status "review"), shown to the owner with a way to fix it;
   * null otherwise. Optional: snapshots published before this field existed lack it.
   */
  reviewReason: z.string().nullable().optional(),
});
export type PublicRecipeDoc = z.infer<typeof PublicRecipeDoc>;

export const PublicRecipe = PublicRecipeDoc.extend({ id: z.string() });
export type PublicRecipe = z.infer<typeof PublicRecipe>;

/** reports/{id} — reports, creator claims, and screening flags (admin queue). */
export const ReportKind = z.enum(["report", "claim", "screening"]);
export const ReportDoc = z.object({
  publicRecipeId: z.string(),
  kind: ReportKind,
  reason: z.string(),
  contact: z.string().nullable(), // email for claims; never shown publicly
  reporterUid: z.string().nullable(), // null when signed out or for screening
  status: z.enum(["open", "resolved"]),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolution: z.enum(["hidden", "restored", "dismissed"]).nullable(),
});
export type ReportDoc = z.infer<typeof ReportDoc>;

// ---------------------------------------------------------------------------
// Tags and search
// ---------------------------------------------------------------------------

export const TAGS = {
  cuisine: ["chinese", "japanese", "korean", "thai", "vietnamese", "indian", "italian", "french",
    "spanish", "mexican", "middle-eastern", "american", "other-cuisine"],
  meal: ["breakfast", "lunch", "dinner", "snack", "dessert", "drink", "side", "sauce"],
  diet: ["vegetarian", "vegan", "gluten-free", "dairy-free", "high-protein"],
} as const;
export const ALL_TAGS: readonly string[] = [...TAGS.cuisine, ...TAGS.meal, ...TAGS.diet];
export const Tag = z.string().refine((t) => ALL_TAGS.includes(t), "unknown tag");
export const MAX_TAGS = 6;

const STOP_WORDS = new Set(["a", "an", "and", "the", "of", "with", "in", "on", "to", "for", "or", "my", "easy"]);

/** Lowercased words (≥2 chars, no stop words) for one search box term. */
export function searchWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/** The indexed terms of a public recipe: title + ingredient items + tags, deduped, ≤100. */
export function searchTerms(recipe: Pick<Recipe, "title" | "ingredients">, tags: readonly string[]): string[] {
  const words = [
    ...searchWords(recipe.title),
    ...recipe.ingredients.flatMap((i) => searchWords(i.item)),
    ...tags,
  ];
  return [...new Set(words)].slice(0, 100);
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MAX_PUBLISHES_PER_DAY = 20; // per user, publish + update
export const MAX_ENGAGEMENTS_PER_DAY = 300; // per user, likes + saves (toggles count)
export const MAX_REPORTS_PER_DAY = 10; // per IP (hashed) and per user
export const MAX_SUGGESTIONS_PER_DAY = 60; // per user, Publish-dialog suggestions
export const EXPLORE_PAGE_SIZE = 24;

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

export const SourcePreview = z.object({
  platform: SourcePlatform,
  videoId: z.string().nullable(),
  url: z.string(), // canonical
  title: z.string().nullable(),
  channelName: z.string().nullable(),
  channelUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  /** A live public recipe for this video already exists (offer it instead). */
  existingPublicId: z.string().nullable(),
});
export type SourcePreview = z.infer<typeof SourcePreview>;

/** What the creator enters; the API resolves it into a RecipeSource. */
export const SourceInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("video"),
    url: z.string().url().max(500), // youtube/tiktok: credit from oEmbed; else creditName required
    creditName: z.string().min(1).max(100).nullable(), // used only for non-oEmbed platforms
    startOffsetSeconds: z.number().int().min(0).max(24 * 3600),
  }),
  z.object({ kind: z.literal("own") }),
  z.object({
    kind: z.literal("other"),
    url: z.string().url().max(500),
    creditName: z.string().min(1).max(100),
  }),
]);
export type SourceInput = z.infer<typeof SourceInput>;

export const PublishRequest = z.object({
  visibility: PublicVisibility,
  source: SourceInput,
  tags: z.array(Tag).max(MAX_TAGS),
  /** Required on the caller's first publish (they have no handle yet); ignored afterwards. */
  handle: Handle.nullable(),
});
export type PublishRequest = z.infer<typeof PublishRequest>;

export const PublishSuggestionsRequest = z.object({
  /** The video/page link entered so far (null for "My own recipe" or before one is typed). */
  sourceUrl: z.string().url().max(500).nullable(),
});
export type PublishSuggestionsRequest = z.infer<typeof PublishSuggestionsRequest>;

export const PublishSuggestionsResponse = z.object({
  tags: z.array(Tag).max(MAX_TAGS), // ids from TAGS, best first; may be empty
  /** e.g. "This video is “5 Minutes EASY Egg Fried Rice” — is that the right link?" */
  creditWarning: z.string().nullable(),
});
export type PublishSuggestionsResponse = z.infer<typeof PublishSuggestionsResponse>;

export const PublishResponse = z.object({ publicRecipe: PublicRecipe });
export type PublishResponse = z.infer<typeof PublishResponse>;

export const EngagementResponse = z.object({
  stats: PublicStats,
  liked: z.boolean(),
  saved: z.boolean(),
});
export type EngagementResponse = z.infer<typeof EngagementResponse>;

export const CopyResponse = z.object({ recipe: CloudRecipe });
export type CopyResponse = z.infer<typeof CopyResponse>;

export const ReportRequest = z.object({
  kind: z.enum(["report", "claim"]),
  reason: z.string().min(1).max(2000),
  contact: z.string().email().max(200).nullable(), // required for claims
});
export type ReportRequest = z.infer<typeof ReportRequest>;

export const AdminQueueItem = z.object({
  report: ReportDoc.extend({ id: z.string() }),
  publicRecipe: PublicRecipe.nullable(), // null if since deleted
});
export const AdminQueueResponse = z.object({ items: z.array(AdminQueueItem) });
export type AdminQueueResponse = z.infer<typeof AdminQueueResponse>;

export const AdminActionRequest = z.object({
  action: z.enum(["hide", "restore", "dismiss"]),
  reportId: z.string().nullable(), // resolves this report (and, for hide/restore, sets status)
  note: z.string().max(500).nullable(),
});
export type AdminActionRequest = z.infer<typeof AdminActionRequest>;
