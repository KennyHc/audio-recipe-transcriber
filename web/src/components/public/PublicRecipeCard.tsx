import { useState, type ReactNode } from "react";
import { Bookmark, Heart } from "lucide-react";
import type { PublicRecipe } from "@recipe/shared";
import { NoodlesLogo } from "@/components/NoodlesLogo";
import { publicHref } from "@/lib/router";

/** "Recipe by {channel}" for credited sources, else "by @handle". */
export function creditLine(pub: Pick<PublicRecipe, "source" | "handle">): string {
  if (pub.source.kind !== "own" && pub.source.channelName) return `Recipe by ${pub.source.channelName}`;
  return `by @${pub.handle}`;
}

export function RecipeThumbnail({ src, className = "" }: { src: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`aspect-video w-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      className={`flex aspect-video w-full items-center justify-center text-[hsl(var(--accent-text))] ${className}`}
      style={{
        backgroundImage:
          "radial-gradient(70% 120% at 100% -10%, hsl(var(--accent-fill) / 0.16), transparent 70%), linear-gradient(180deg, hsl(var(--accent-tint)), hsl(var(--accent-tint) / 0.5))",
      }}
    >
      <NoodlesLogo className="h-12 w-12 opacity-80" />
    </span>
  );
}

export function PublicRecipeCard({ pub, footer }: { pub: PublicRecipe; footer?: ReactNode }) {
  return (
    <div className="group relative h-full overflow-hidden rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] transition-all duration-150 hover:-translate-y-0.5 hover:border-[hsl(var(--border-strong))] hover:shadow-[var(--shadow-float)]">
      <a href={publicHref(pub.id)} className="flex h-full flex-col">
        <RecipeThumbnail src={pub.source.thumbnailUrl} />
        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <p className="font-serif text-xl leading-tight text-[hsl(var(--ink))] transition-colors group-hover:text-[hsl(var(--accent-text))] line-clamp-2">
            {pub.recipe.title}
          </p>
          <p className="truncate text-sm text-[hsl(var(--ink-muted))]">{creditLine(pub)}</p>
          <div className="mt-auto flex items-center gap-3 pt-1 text-xs tabular-nums text-[hsl(var(--ink-faint))]">
            <span className="inline-flex items-center gap-1" aria-label={`${pub.stats.likes} likes`}>
              <Heart className="h-3.5 w-3.5" /> {pub.stats.likes}
            </span>
            <span className="inline-flex items-center gap-1" aria-label={`${pub.stats.saves} saves`}>
              <Bookmark className="h-3.5 w-3.5" /> {pub.stats.saves}
            </span>
          </div>
        </div>
      </a>
      {footer}
    </div>
  );
}
