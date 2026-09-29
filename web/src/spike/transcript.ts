// Local copy of the `Transcript` shape from shared/recipe.ts, kept in sync by hand.
// This is a throwaway spike page — it must not import from shared/ or modify it.
export interface TranscriptSegment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface Transcript {
  language: string | null;
  segments: TranscriptSegment[];
}
