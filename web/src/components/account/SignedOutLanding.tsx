import { useEffect, useState } from "react";
import type { PublicRecipe } from "@recipe/shared";
import { publicBank } from "@/backend";
import { PublicRecipeCard } from "@/components/public/PublicRecipeCard";
import { UploadCloud, Laptop, ListChecks, ShieldCheck, Cloud, History, Compass, ArrowRight } from "lucide-react";
import { SignInPanel } from "@/components/account/SignInPanel";
import { exploreHref, privacyHref } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { consumeAccountDeleted } from "@/lib/accountPrefs";

const HOW_IT_WORKS = [
  { icon: UploadCloud, text: "Drop a clip", short: "Drop a clip" },
  { icon: Laptop, text: "Transcribed on your device", short: "Transcribed locally" },
  { icon: ListChecks, text: "A recipe you can check against the audio", short: "Check vs audio" },
];

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Your audio stays on your device",
    text: "Speech-to-text runs in your browser. Only the transcript is sent to make the recipe.",
  },
  {
    icon: Cloud,
    title: "Your recipes, on every device",
    text: "Recipes are saved privately to your account, in the EU. Sign in anywhere to cook from them.",
  },
  {
    icon: History,
    title: "Edit freely, nothing is lost",
    text: "Every edit is a new version. Fix a quantity, restore an old one, or re-extract from the transcript.",
  },
];

/** The library route while signed out (cloud mode): what the app does, and how to sign in. */
export function SignedOutLanding() {
  const [deleted] = useState(() => consumeAccountDeleted());
  const [recent, setRecent] = useState<PublicRecipe[]>([]);

  useEffect(() => {
    let cancelled = false;
    publicBank
      ?.recentPublic(4)
      .then((items) => {
        if (!cancelled) setRecent(items);
      })
      .catch(() => undefined); // the strip is a nice-to-have; the landing works without it
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-6 sm:py-14 space-y-6 sm:space-y-10">
      {deleted && (
        <p className="rounded-[10px] border border-[hsl(var(--accent-tint-strong))] bg-[hsl(var(--accent-tint))] px-4 py-3 text-sm text-[hsl(var(--accent-text))]">
          Your account and everything in it were deleted.
        </p>
      )}

      <div
        className="relative overflow-hidden rounded-[14px] px-5 py-6 sm:px-10 sm:py-12 space-y-5 sm:space-y-8"
        style={{
          backgroundImage:
            "radial-gradient(70% 120% at 100% -10%, hsl(var(--accent-fill) / 0.14), transparent 70%), radial-gradient(45% 80% at 85% 0%, hsl(var(--accent-fill) / 0.1), transparent 75%), linear-gradient(180deg, hsl(var(--accent-tint) / 0.6), hsl(var(--background)))",
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 lg:items-center">
          <div className="space-y-3">
            <h1 className="font-serif text-[34px] sm:text-[48px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
              Turn cooking audio into recipes
            </h1>
            <p className="text-[hsl(var(--ink-muted))] max-w-[60ch]">
              Upload one audio recording of someone talking through a recipe — get a structured,
              verifiable recipe back, with every quantity linked to the moment it was said.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button asChild variant="outline">
                <a href={exploreHref()}>
                  <Compass className="h-4 w-4" /> Browse recipes
                </a>
              </Button>
              <span className="text-sm text-[hsl(var(--ink-muted))]">No account needed to cook.</span>
            </div>
            <p className="text-xs text-[hsl(var(--ink-faint))]">
              Audio stays on your device.{" "}
              <a
                href={privacyHref()}
                className="text-[hsl(var(--ink-muted))] underline underline-offset-2 hover:text-[hsl(var(--ink))]"
              >
                Privacy
              </a>
            </p>
          </div>

          <SignInPanel />
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-[hsl(var(--border))] pt-4 sm:hidden">
          {HOW_IT_WORKS.map(({ icon: Icon, short }, i) => (
            <div key={i} className="flex flex-col items-center gap-1 text-center">
              <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--accent-text))]" />
              <span className="text-[11px] leading-tight text-[hsl(var(--ink-muted))]">{short}</span>
            </div>
          ))}
        </div>
        <div className="hidden sm:grid sm:grid-cols-3 gap-4 sm:gap-6 border-t border-[hsl(var(--border))] pt-6">
          {HOW_IT_WORKS.map(({ icon: Icon, text }, i) => (
            <div key={i} className="flex items-center gap-2.5 text-sm text-[hsl(var(--ink-muted))]">
              <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--accent-text))]" />
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {recent.length > 0 && (
        <section aria-labelledby="recently-shared" className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2
              id="recently-shared"
              className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]"
            >
              Recently shared
            </h2>
            <a
              href={exploreHref()}
              className="inline-flex items-center gap-1 text-sm text-[hsl(var(--accent-text))] underline-offset-4 hover:underline"
            >
              Explore all <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((pub) => (
              <li key={pub.id}>
                <PublicRecipeCard pub={pub} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li
            key={title}
            className="space-y-2 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
              <Icon className="h-4 w-4" />
            </span>
            <p className="font-medium text-[hsl(var(--ink))]">{title}</p>
            <p className="text-sm text-[hsl(var(--ink-muted))]">{text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
