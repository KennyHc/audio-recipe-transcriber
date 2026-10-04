import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { privacyHref, useRoute } from "@/lib/router";
import { Library } from "@/pages/Library";
import { JobPage } from "@/pages/JobPage";
import { Settings } from "@/pages/Settings";
import { Privacy } from "@/pages/Privacy";
import { backend } from "@/backend";
import { IS_HOSTED } from "@/lib/mode";
import { Settings as SettingsIcon } from "lucide-react";
import { NoodlesLogo } from "@/components/NoodlesLogo";

export default function App() {
  const route = useRoute();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen flex flex-col">
        <header className="no-print border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
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
              <span className="hidden sm:inline text-xs text-[hsl(var(--ink-faint))] mr-1">
                {IS_HOSTED ? "Free · runs in your browser" : backend.kind === "browser" ? "Runs in your browser" : "Local server"}
              </span>
              {backend.kind === "browser" && (
                <a
                  href="#/settings"
                  aria-label="Settings"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-[hsl(var(--ink-muted))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
                >
                  <SettingsIcon className="h-4 w-4" />
                </a>
              )}
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="flex-1">
          {route.name === "settings" ? (
            <Settings />
          ) : route.name === "privacy" ? (
            <Privacy />
          ) : route.name === "library" ? (
            <Library />
          ) : (
            <JobPage jobId={route.id} cookRoute={route.cook} />
          )}
        </main>
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
