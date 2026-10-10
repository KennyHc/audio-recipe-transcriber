import { EyeOff, Globe, Hourglass, Link2 } from "lucide-react";
import type { PublicRecipe } from "@recipe/shared";
import { cn } from "@/lib/utils";

/** "Public" / "Link only" / "In review" / "Hidden" — the published state of the owner's recipe. */
export function publicStatusLabel(pub: Pick<PublicRecipe, "status" | "visibility">): string {
  if (pub.status === "review") return "In review";
  if (pub.status === "hidden") return "Hidden";
  return pub.visibility === "public" ? "Public" : "Link only";
}

export function PublicStatusPill({
  pub,
  className,
}: {
  pub: Pick<PublicRecipe, "status" | "visibility">;
  className?: string;
}) {
  const live = pub.status === "live";
  const Icon = pub.status === "review" ? Hourglass : pub.status === "hidden" ? EyeOff : pub.visibility === "public" ? Globe : Link2;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        live
          ? "bg-[hsl(var(--accent-tint-strong))] text-[hsl(var(--accent-text))]"
          : "border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--sunken))] text-[hsl(var(--ink-muted))]",
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {publicStatusLabel(pub)}
    </span>
  );
}
