import { Fragment } from "react";
import type { StepTextSegment } from "@/lib/stepQuantities";

/**
 * Renders a step's (already scaled/converted) text, subtly marking any span that was
 * rewritten from the original words — accent color + dotted underline, with the original
 * wording in a tooltip. When nothing changed, this renders as plain text identical to the
 * unmarked string, no extra markup.
 */
export function StepText({ segments }: { segments: StepTextSegment[] }) {
  return (
    <>
      {segments.map((segment, i) =>
        segment.original ? (
          <span
            key={i}
            title={`Said: "${segment.original}"`}
            className="text-[hsl(var(--accent-text))] underline decoration-dotted decoration-1 underline-offset-2 cursor-help"
          >
            {segment.text}
          </span>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
