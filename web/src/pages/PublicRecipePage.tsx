import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  ChefHat,
  Clock,
  CopyPlus,
  ExternalLink,
  Flag,
  Heart,
  Link2,
  Loader2,
  MoreHorizontal,
  Check,
  PlayCircle,
  UserCheck,
} from "lucide-react";
import type { PublicRecipe, PublicStats } from "@recipe/shared";
import { publicBank } from "@/backend";
import { useAccountUser } from "@/lib/useAccount";
import { track } from "@/lib/analytics";
import { creatorHref, exploreHref, jobHref, navigate, publicUrl } from "@/lib/router";
import { isYouTube, timestampAction, timestampsUseful } from "@/lib/videoSeek";
import { reviewNotice, tagLabel } from "@/lib/publish";
import { formatDuration } from "@/lib/format";
import { AudioAvailableContext } from "@/lib/audioAvailability";
import type { UnitSystem } from "@/lib/units";
import { cn } from "@/lib/utils";
import { RecipeView } from "@/components/RecipeView";
import { ServingsScaler } from "@/components/ServingsScaler";
import { UnitsToggle } from "@/components/UnitsToggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/public/YouTubePlayer";
import { RecipeThumbnail } from "@/components/public/PublicRecipeCard";
import { ReportDialog, type ReportKind } from "@/components/public/ReportDialog";
import { SignInPromptDialog } from "@/components/public/SignInPromptDialog";
import { AddToShoppingListButton } from "@/components/shopping/AddToShoppingListButton";
import { PublicStatusPill } from "@/components/publish/PublicStatusPill";
import { NoodlesLogo } from "@/components/NoodlesLogo";

const LINK = "text-[hsl(var(--accent-text))] underline-offset-4 hover:underline";

function Unavailable() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-4">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[14px] bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
        <NoodlesLogo className="h-8 w-8" />
      </span>
      <h1 className="font-serif text-[34px] leading-[1.05] text-[hsl(var(--ink))]">This recipe isn't available</h1>
      <p className="text-[hsl(var(--ink-muted))]">
        It may have been unpublished by the person who shared it, or taken down. Plenty more to cook, though.
      </p>
      <Button asChild>
        <a href={exploreHref()}>Browse recipes</a>
      </Button>
    </div>
  );
}

function Credit({ pub }: { pub: PublicRecipe }) {
  const s = pub.source;
  const channel = s.channelName ? (
    s.channelUrl ? (
      <a href={s.channelUrl} target="_blank" rel="noreferrer" className="font-semibold text-[hsl(var(--ink))] hover:underline underline-offset-4">
        {s.channelName}
      </a>
    ) : (
      <strong className="font-semibold text-[hsl(var(--ink))]">{s.channelName}</strong>
    )
  ) : null;

  if (s.kind === "own") {
    return (
      <p className="text-[hsl(var(--ink-muted))]">
        Original recipe by{" "}
        <a href={creatorHref(pub.handle)} className="font-semibold text-[hsl(var(--ink))] underline-offset-4 hover:underline">
          @{pub.handle}
        </a>
      </p>
    );
  }
  return (
    <div className="space-y-0.5">
      <p className="text-[hsl(var(--ink-muted))]">
        {s.kind === "video" ? "Recipe by " : "Recipe from "}
        {channel ?? <span>the original</span>}
        {s.url && (
          <>
            {" · "}
            <a href={s.url} target="_blank" rel="noreferrer" className={LINK}>
              {s.kind === "video" ? "Watch the original video" : "View the original"}
            </a>
          </>
        )}
      </p>
      <p className="text-sm text-[hsl(var(--ink-faint))]">
        Transcribed by{" "}
        <a
          href={creatorHref(pub.handle)}
          className="text-[hsl(var(--ink-muted))] underline-offset-4 hover:text-[hsl(var(--accent-text))] hover:underline"
        >
          @{pub.handle}
        </a>
      </p>
    </div>
  );
}

/** The owner's one-line status on their own public page (the fix lives on the private page). */
function ownerBannerText(pub: PublicRecipe): string {
  const notice = reviewNotice(pub);
  switch (notice?.kind) {
    case undefined:
      return "This is your published recipe.";
    case "flagged":
      return "Held by the automatic check — only you can see this page. Open your private recipe to see why and change the source.";
    case "unavailable":
      return "We couldn't run the automatic check — a moderator will review it soon. Only you can see this page for now.";
    case "waiting":
      return "Waiting for a quick review — only you can see this page for now.";
    case "hidden":
      return "Hidden by a moderator — only you can see this page.";
  }
}

// Cook mode is opened by few visitors; load it on demand (page-weight pass).
const CookMode = lazy(() => import("@/components/cook/CookMode").then((m) => ({ default: m.CookMode })));

/** The public recipe page, /r/{id} (cloud mode; works signed out). */
export function PublicRecipePage({ id }: { id: string }) {
  const user = useAccountUser();
  const [pub, setPub] = useState<PublicRecipe | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [unitSystem, setUnitSystem] = useState<UnitSystem>("original");
  const [scaleFactor, setScaleFactor] = useState(1);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [cookOpen, setCookOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null); // no audio on public pages

  const playerRef = useRef<YouTubePlayerHandle>(null);
  const [embedBlocked, setEmbedBlocked] = useState(false);

  const [engagement, setEngagement] = useState<{ liked: boolean; saved: boolean }>({ liked: false, saved: false });
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [busy, setBusy] = useState<"like" | "save" | "copy" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [signInFor, setSignInFor] = useState<string | null>(null);
  const [report, setReport] = useState<ReportKind | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!publicBank) return;
    let cancelled = false;
    setPub(undefined);
    setLoadError(null);
    setEmbedBlocked(false);
    setScaleFactor(1);
    setUnitSystem("original");
    setChecked(new Set());
    publicBank
      .getPublicRecipe(id)
      .then((p) => {
        if (cancelled) return;
        setPub(p);
        setStats(p?.stats ?? null);
        if (p) track("recipe_view", p.id); // anonymous daily count, once per recipe per session
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load this recipe.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Liked/saved state needs the signed-in user (re-read when they sign in here).
  useEffect(() => {
    if (!publicBank || !user || !pub) {
      setEngagement({ liked: false, saved: false });
      return;
    }
    let cancelled = false;
    publicBank
      .getEngagement(pub.id)
      .then((e) => !cancelled && setEngagement(e))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, pub]);

  useEffect(() => {
    if (!pub) return;
    const previous = document.title;
    document.title = `${pub.recipe.title} · Recipe Transcriber`;
    return () => {
      document.title = previous;
    };
  }, [pub]);

  if (!publicBank) return <Unavailable />;
  if (loadError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-3">
        <p className="text-[hsl(var(--danger))]">{loadError}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (pub === undefined) {
    return <div className="mx-auto max-w-[1120px] px-4 py-10 text-[hsl(var(--ink-muted))]">Loading…</div>;
  }
  const isOwner = !!user && pub !== null && pub.ownerId === user.uid;
  if (pub === null || (pub.status !== "live" && !isOwner)) return <Unavailable />;

  const bank = publicBank;
  const recipe = pub.recipe;
  const source = pub.source;
  const youTube = isYouTube(source) && !embedBlocked ? source : null;
  const currentStats = stats ?? pub.stats;

  function onSeek(t: number) {
    const action = timestampAction(source, t, youTube !== null);
    if (!action) return;
    if (action.kind === "seek") playerRef.current?.seek(action.seconds);
    else window.open(action.url, "_blank", "noopener,noreferrer");
  }

  async function toggle(kind: "like" | "save") {
    if (!user) {
      setSignInFor(kind === "like" ? "like recipes" : "save recipes");
      return;
    }
    setBusy(kind);
    setActionError(null);
    const next = kind === "like" ? !engagement.liked : !engagement.saved;
    try {
      const res = kind === "like" ? await bank.setLike(pub!.id, next) : await bank.setSave(pub!.id, next);
      setEngagement({ liked: res.liked, saved: res.saved });
      setStats(res.stats);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function makeCopy() {
    if (!user) {
      setSignInFor("make a copy");
      return;
    }
    setBusy("copy");
    setActionError(null);
    try {
      const copy = await bank.copy(pub!.id);
      navigate(jobHref(copy.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't make a copy. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function copyLink() {
    navigator.clipboard
      ?.writeText(publicUrl(pub!.id))
      .then(() => {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      })
      .catch(() => undefined);
  }

  function toggleIngredient(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const media =
    youTube !== null ? (
      <YouTubePlayer
        ref={playerRef}
        videoId={youTube.videoId}
        startSeconds={source.startOffsetSeconds}
        thumbnailUrl={source.thumbnailUrl}
        title={source.title ?? recipe.title}
        onUnavailable={() => setEmbedBlocked(true)}
        suspended={cookOpen}
      />
    ) : source.kind === "video" && source.url ? (
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="group relative block overflow-hidden rounded-[10px] border border-[hsl(var(--border))]"
      >
        <RecipeThumbnail src={source.thumbnailUrl} />
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-[rgb(15_27_45_/_0.72)] px-3 py-2 text-sm font-medium text-white">
          <PlayCircle className="h-4 w-4" />
          Watch on {source.platform === "tiktok" ? "TikTok" : source.platform === "youtube" ? "YouTube" : "the original site"}
          <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-80" />
        </span>
      </a>
    ) : null;

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-6 pb-16 space-y-6">
      <a
        href={exploreHref()}
        className="no-print inline-flex items-center gap-1 text-sm text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Explore recipes
      </a>

      {isOwner && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-[10px] border border-[hsl(var(--accent-tint-strong))] bg-[hsl(var(--accent-tint))] px-4 py-2.5 text-sm text-[hsl(var(--accent-text))]">
          <PublicStatusPill pub={pub} />
          <span>
            {ownerBannerText(pub)}
          </span>
          <a href={jobHref(pub.id)} className="ml-auto underline underline-offset-2">
            Open your private recipe
          </a>
        </div>
      )}

      <div
        className="print-area relative overflow-hidden rounded-[14px] border border-[hsl(var(--border))] p-5 sm:p-7 space-y-5"
        style={{
          backgroundImage:
            "radial-gradient(80% 140% at 100% -20%, hsl(var(--accent-fill) / 0.08), transparent 70%), radial-gradient(50% 90% at 88% 0%, hsl(var(--accent-fill) / 0.06), transparent 75%), linear-gradient(180deg, hsl(var(--accent-tint) / 0.4), hsl(var(--background)))",
        }}
      >
        <div className={cn("grid grid-cols-1 gap-6", media && "lg:grid-cols-[1fr_440px] lg:items-start")}>
          <div className="space-y-3 min-w-0">
            <h1 className="font-serif text-[34px] sm:text-[44px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
              {recipe.title}
            </h1>
            <Credit pub={pub} />
            {recipe.description && <p className="max-w-[65ch] text-[hsl(var(--ink-muted))]">{recipe.description}</p>}
            <p className="text-xs tabular-nums text-[hsl(var(--ink-faint))]">
              {`${recipe.ingredients.length} ingredient${recipe.ingredients.length === 1 ? "" : "s"} · ${recipe.steps.length} step${recipe.steps.length === 1 ? "" : "s"}`}
            </p>
            {pub.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pub.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-0.5 text-xs text-[hsl(var(--ink-muted))]"
                  >
                    {tagLabel(t)}
                  </span>
                ))}
              </div>
            )}
          </div>
          {media && <div className="no-print min-w-0">{media}</div>}
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setCookOpen(true)}>
            <ChefHat className="h-3.5 w-3.5" /> Cook
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={engagement.liked}
            onClick={() => toggle("like")}
            disabled={busy === "like"}
            className={cn(engagement.liked && "border-[hsl(var(--accent-fill))] text-[hsl(var(--accent-text))]")}
          >
            <Heart className={cn("h-3.5 w-3.5", engagement.liked && "fill-current")} />
            <span className="tabular-nums">{currentStats.likes}</span>
            <span className="sr-only">{engagement.liked ? "Unlike" : "Like"}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={engagement.saved}
            onClick={() => toggle("save")}
            disabled={busy === "save"}
            className={cn(engagement.saved && "border-[hsl(var(--accent-fill))] text-[hsl(var(--accent-text))]")}
          >
            <Bookmark className={cn("h-3.5 w-3.5", engagement.saved && "fill-current")} />
            {engagement.saved ? "Saved" : "Save"}
            <span className="tabular-nums text-[hsl(var(--ink-faint))]">{currentStats.saves}</span>
          </Button>
          <Button size="sm" variant="outline" onClick={makeCopy} disabled={busy === "copy"}>
            {busy === "copy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CopyPlus className="h-3.5 w-3.5" />}
            Make a copy
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[hsl(var(--border-strong))] text-[hsl(var(--ink-muted))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={copyLink}>
                {linkCopied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                {linkCopied ? "Link copied" : "Copy link"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {source.kind === "video" && (
                <DropdownMenuItem onSelect={() => setReport("claim")}>
                  <UserCheck className="h-3.5 w-3.5" /> Is this your video?
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setReport("report")}>
                <Flag className="h-3.5 w-3.5" /> Report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {actionError && (
          <p role="alert" className="no-print text-sm text-[hsl(var(--danger))]">
            {actionError}
          </p>
        )}

        <div className="no-print flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))] pt-4">
          <ServingsScaler originalServings={recipe.servings} factor={scaleFactor} onFactorChange={setScaleFactor} />
          <UnitsToggle value={unitSystem} onChange={setUnitSystem} />
          {recipe.totalTimeMinutes !== null && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] px-3 py-1 text-sm text-[hsl(var(--ink-muted))]">
              <Clock className="h-3.5 w-3.5" /> {formatDuration(recipe.totalTimeMinutes)}
            </span>
          )}
        </div>
      </div>

      {/* Timestamps seek the creator's video (YouTube) or open it at that moment. */}
      <AudioAvailableContext.Provider value={timestampsUseful(source)}>
        <RecipeView
          recipe={recipe}
          unitSystem={unitSystem}
          scaleFactor={scaleFactor}
          onSeek={onSeek}
          currentTime={null}
          checkedIngredients={checked}
          onToggleIngredient={toggleIngredient}
          audience="public"
          ingredientsAction={
            <AddToShoppingListButton
              recipeId={pub.id}
              title={recipe.title}
              isPublic
              ingredients={recipe.ingredients}
              scaleFactor={scaleFactor}
              onNeedSignIn={() => setSignInFor("add to your shopping list")}
            />
          }
        />
      </AudioAvailableContext.Provider>

      {source.kind === "video" && (
        <p className="no-print text-xs text-[hsl(var(--ink-faint))]">
          Written out from the video by @{pub.handle} with Recipe Transcriber. All credit for the recipe goes to{" "}
          {source.channelName ?? "its creator"}.{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => setReport("claim")}>
            Is this your video?
          </button>
        </p>
      )}

      {cookOpen && (
        <AudioAvailableContext.Provider value={false}>
          <Suspense fallback={null}>
            <CookMode
              recipe={recipe}
              unitSystem={unitSystem}
              scaleFactor={scaleFactor}
              checkedIngredients={checked}
              onToggleIngredient={toggleIngredient}
              audioRef={audioRef}
              onClose={() => setCookOpen(false)}
            />
          </Suspense>
        </AudioAvailableContext.Provider>
      )}

      <SignInPromptDialog open={signInFor !== null} onOpenChange={(o) => !o && setSignInFor(null)} action={signInFor ?? ""} />
      <ReportDialog
        open={report !== null}
        onOpenChange={(o) => !o && setReport(null)}
        publicId={pub.id}
        kind={report ?? "report"}
        channelName={source.channelName}
      />
    </div>
  );
}
