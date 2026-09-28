export type WarningTarget = { kind: "ingredients" | "steps"; index: number } | null;

/** Parse warning.target strings like "ingredients[2]" or "steps[4]". Null/unrecognized = general. */
export function parseWarningTarget(target: string | null): WarningTarget {
  if (!target) return null;
  const match = /^(ingredients|steps)\[(\d+)\]$/.exec(target.trim());
  if (!match) return null;
  return { kind: match[1] as "ingredients" | "steps", index: Number(match[2]) };
}

export function targetElementId(target: WarningTarget): string | null {
  if (!target) return null;
  return `${target.kind === "ingredients" ? "ingredient" : "step"}-${target.index}`;
}

export function scrollToTarget(target: string | null) {
  const parsed = parseWarningTarget(target);
  const id = targetElementId(parsed);
  if (!id) return;
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-[hsl(var(--caution-icon))]");
    setTimeout(() => el.classList.remove("ring-2", "ring-[hsl(var(--caution-icon))]"), 1800);
  }
}
