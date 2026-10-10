import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { exploreHref, privacyHref, termsHref, useRoute, type Route } from "@/lib/router";
import { Library } from "@/pages/Library";
import { JobPage } from "@/pages/JobPage";
import { Settings } from "@/pages/Settings";
import { Privacy } from "@/pages/Privacy";
import { Terms } from "@/pages/Terms";
import { Explore } from "@/pages/Explore";
import { PublicRecipePage } from "@/pages/PublicRecipePage";
import { Admin } from "@/pages/Admin";
import { useState } from "react";
import { account, backend } from "@/backend";
import { IS_CLOUD, IS_HOSTED } from "@/lib/mode";
import { useAccountUser } from "@/lib/useAccount";
import { AccountMenu } from "@/components/account/AccountMenu";
import { SignedOutLanding } from "@/components/account/SignedOutLanding";
import { EmailLinkLanding } from "@/components/account/EmailLinkLanding";
import { Compass, Settings as SettingsIcon } from "lucide-react";
import { NoodlesLogo } from "@/components/NoodlesLogo";

/** Pages anyone can open in cloud mode, signed in or not. */
const OPEN_ROUTES: ReadonlySet<Route["name"]> = new Set(["privacy", "terms", "explore", "public"]);
/** Pages that exist only in cloud mode (the public bank). */
const CLOUD_ONLY_ROUTES: ReadonlySet<Route["name"]> = new Set(["explore", "admin"]);

export default function App() {
  const rawRoute = useRoute();
  const route: Route = !IS_CLOUD && CLOUD_ONLY_ROUTES.has(rawRoute.name) ? { name: "library" } : rawRoute;
  const user = useAccountUser();
  // Cloud mode: an emailed sign-in link lands on the page with its own query (see
  // backend/cloud/account.ts); it's handled before the hash routes.
  const [onSignInLink, setOnSignInLink] = useState(() => !!account?.isSignInLink(window.location.href));

  // Cloud mode gates everything but the public pages (Explore, /r/{id}, Terms, Privacy) on being
  // signed in.
  const gate: "open" | "restoring" | "signed-out" =
    !IS_CLOUD || OPEN_ROUTES.has(route.name) ? "open" : user === undefined ? "restoring" : user === null ? "signed-out" : "open";

  const content = onSignInLink ? (
    <EmailLinkLanding onDone={() => setOnSignInLink(false)} />
  ) : gate === "restoring" ? (
    <div className="mx-auto max-w-[1120px] px-4 py-10 text-sm text-[hsl(var(--ink-muted))]">Loading…</div>
  ) : gate === "signed-out" ? (
    <SignedOutLanding />
  ) : route.name === "settings" ? (
    <Settings />
  ) : route.name === "privacy" ? (
    <Privacy />
  ) : route.name === "terms" ? (
    <Terms />
  ) : route.name === "explore" ? (
    <Explore />
  ) : route.name === "public" ? (
    <PublicRecipePage id={route.id} />
  ) : route.name === "admin" ? (
    <Admin />
  ) : route.name === "library" ? (
    <Library />
  ) : (
    <JobPage jobId={route.id} cookRoute={route.cook} />
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen flex flex-col">
        <header className="no-print sticky top-0 z-40 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface)/0.75)] backdrop-blur-md">
          <div className="mx-auto max-w-[1120px] px-4 py-2.5 flex items-center justify-between gap-2">
            <a href="#/" className="flex items-center gap-2.5 group">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
                <NoodlesLogo className="h-[21px] w-[21px]" />
              </span>
              <span className="font-semibold text-[15px] tracking-tight text-[hsl(var(--ink))] group-hover:text-[hsl(var(--accent-text))] transition-colors">
                Recipe Transcriber
              </span>
            </a>
            <div className="flex items-center gap-1">
              {!IS_CLOUD && (
                <span className="hidden sm:inline text-xs text-[hsl(var(--ink-faint))] mr-1">
                  {IS_HOSTED ? "Free · runs in your browser" : backend.kind === "browser" ? "Runs in your browser" : "Local server"}
                </span>
              )}
              {backend.kind === "browser" && !IS_CLOUD && (
                <a
                  href="#/settings"
                  aria-label="Settings"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-[hsl(var(--ink-muted))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
                >
                  <SettingsIcon className="h-4 w-4" />
                </a>
              )}
              {IS_CLOUD && (
                <a
                  href={exploreHref()}
                  aria-current={route.name === "explore" ? "page" : undefined}
                  aria-label="Explore recipes"
                  className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-2.5 text-sm text-[hsl(var(--ink-muted))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))] aria-[current=page]:text-[hsl(var(--accent-text))]"
                >
                  <Compass className="h-4 w-4" />
                  <span className="hidden sm:inline">Explore</span>
                </a>
              )}
              <ThemeToggle />
              {IS_CLOUD && user && <AccountMenu user={user} />}
              {IS_CLOUD && user === null && route.name !== "library" && (
                <a
                  href="#/"
                  className="ml-1 inline-flex h-9 items-center rounded-[8px] border border-[hsl(var(--border-strong))] px-3 text-sm font-medium text-[hsl(var(--ink))] transition-colors hover:bg-[hsl(var(--accent-tint))]"
                >
                  Sign in
                </a>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1">{content}</main>
        <footer className="no-print border-t border-[hsl(var(--border))] py-5">
          <div className="mx-auto max-w-[1120px] px-4 flex justify-center gap-4">
            <a
              href={privacyHref()}
              className="text-xs text-[hsl(var(--ink-faint))] hover:text-[hsl(var(--ink-muted))] transition-colors"
            >
              Privacy
            </a>
            {IS_CLOUD && (
              <a
                href={termsHref()}
                className="text-xs text-[hsl(var(--ink-faint))] hover:text-[hsl(var(--ink-muted))] transition-colors"
              >
                Terms of use
              </a>
            )}
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
