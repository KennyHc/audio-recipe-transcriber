import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useRoute } from "@/lib/router";
import { Library } from "@/pages/Library";
import { JobPage } from "@/pages/JobPage";
import { AudioLines } from "lucide-react";

export default function App() {
  const route = useRoute();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen flex flex-col">
        <header className="no-print border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
          <div className="mx-auto max-w-[1120px] px-4 py-2.5 flex items-center justify-between gap-2">
            <a href="#/" className="flex items-center gap-2.5 group">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
                <AudioLines className="h-4 w-4" />
              </span>
              <span className="font-semibold text-[15px] tracking-tight text-[hsl(var(--ink))] group-hover:text-[hsl(var(--accent-text))] transition-colors">
                Recipe Transcriber
              </span>
            </a>
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1">
          {route.name === "library" ? <Library /> : <JobPage jobId={route.id} />}
        </main>
      </div>
    </TooltipProvider>
  );
}
