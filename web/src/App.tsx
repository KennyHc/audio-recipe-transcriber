import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { privacyHref, useRoute } from "@/lib/router";
import { Library } from "@/pages/Library";
import { JobPage } from "@/pages/JobPage";
import { Settings } from "@/pages/Settings";
import { Privacy } from "@/pages/Privacy";
import { useState } from "react";
import { account, backend } from "@/backend";
import { IS_CLOUD, IS_HOSTED } from "@/lib/mode";
import { useAccountUser } from "@/lib/useAccount";
import { AccountMenu } from "@/components/account/AccountMenu";
import { SignedOutLanding } from "@/components/account/SignedOutLanding";
import { EmailLinkLanding } from "@/components/account/EmailLinkLanding";
import { Settings as SettingsIcon } from "lucide-react";
import { NoodlesLogo } from "@/components/NoodlesLogo";

export default function App() {
  const route = useRoute();
  const user = useAccountUser();
  // Cloud mode: an emailed sign-in link lands on the page with its own query (see
  // backend/cloud/account.ts); it's handled before the hash routes.
  const [onSignInLink, setOnSignInLink] = useState(() => !!account?.isSignInLink(window.location.href));

  // Cloud mode gates everything but the Privacy page on being signed in.
  const gate: "open" | "restoring" | "signed-out" =
    !IS_CLOUD || route.name === "privacy" ? "open" : user === undefined ? "restoring" : user === null ? "signed-out" : "open";

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
              <ThemeToggle />
              {IS_CLOUD && user && <AccountMenu user={user} />}
            </div>
          </div>
        </header>
        <main className="flex-1">{content}</main>
        <footer className="no-print border-t border-[hsl(var(--border))] py-5">
          <div className="mx-auto max-w-[1120px] px-4 flex justify-center">
            <a
              href={privacyHref()}
              className="text-xs text-[hsl(var(--ink-faint))] hover:text-[hsl(var(--ink-muted))] transition-colors"
            >
              Privacy
            </a>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
