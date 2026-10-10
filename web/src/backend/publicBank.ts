import type {
  AdminActionRequest,
  AdminQueueResponse,
  CloudRecipe,
  EngagementResponse,
  PublicRecipe,
  PublishRequest,
  PublishSuggestionsResponse,
  ReportRequest,
  SourcePreview,
} from "@recipe/shared";
import type { ExploreParams } from "@/lib/explore";

// The public recipe bank, cloud mode only (Phase 2 — contract: shared/public.ts). Like Account,
// this interface is free of Firebase types so pages can compile into every build; the
// implementation (backend/cloud/publicBank.ts) is only loaded in the cloud build, and
// `publicBank` (exported from backend/index.ts) is null everywhere else.
//
// Reads go straight to Firestore (signed out too — see firebase/firestore.rules); everything
// that changes public data goes through the API.

export interface ExplorePage {
  items: PublicRecipe[];
  /** Pass back to load the next page; null when there are no more. Opaque. */
  cursor: unknown | null;
  /** Popular was asked for, but a search is always newest-first. */
  sortedByNewestForSearch: boolean;
}

export interface SavedEntry {
  id: string;
  savedAt: string | null;
  /** null when the recipe was unpublished, hidden, or deleted. */
  recipe: PublicRecipe | null;
}

export interface PublicBank {
  /** A live public recipe by id (or the caller's own / any for admins). null if unavailable. */
  getPublicRecipe(id: string): Promise<PublicRecipe | null>;
  explore(params: ExploreParams, cursor: unknown | null): Promise<ExplorePage>;
  /** The signed-in user's published snapshots, by id (for "Published" badges). */
  listOwnPublished(): Promise<Map<string, PublicRecipe>>;
  /** The signed-in user's saved recipes, newest save first. */
  listSaved(): Promise<SavedEntry[]>;
  /** Whether the signed-in user liked/saved this recipe (false/false when signed out). */
  getEngagement(publicId: string): Promise<{ liked: boolean; saved: boolean }>;

  previewSource(url: string): Promise<SourcePreview>;
  publish(id: string, body: PublishRequest): Promise<PublicRecipe>;
  /** Suggested tags + a wrong-link warning for the Publish dialog (sourceUrl null for "own"). */
  publishSuggestions(id: string, sourceUrl: string | null): Promise<PublishSuggestionsResponse>;
  unpublish(id: string): Promise<void>;
  setLike(publicId: string, liked: boolean): Promise<EngagementResponse>;
  setSave(publicId: string, saved: boolean): Promise<EngagementResponse>;
  /** A private, editable copy in the caller's library. */
  copy(publicId: string): Promise<CloudRecipe>;
  report(publicId: string, body: ReportRequest): Promise<void>;
  adminQueue(): Promise<AdminQueueResponse>;
  adminAction(publicId: string, body: AdminActionRequest): Promise<void>;
}
