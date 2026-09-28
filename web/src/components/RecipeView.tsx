import type { Recipe } from "@recipe/shared";
import { WarningsPanel } from "@/components/WarningsPanel";
import { IngredientList } from "@/components/IngredientList";
import { StepsList } from "@/components/StepsList";
import { TipsList } from "@/components/TipsList";
import type { UnitSystem } from "@/lib/units";

export function RecipeView({
  recipe,
  unitSystem,
  scaleFactor,
  onSeek,
  currentTime,
}: {
  recipe: Recipe;
  unitSystem: UnitSystem;
  scaleFactor: number;
  onSeek: (seconds: number) => void;
  currentTime: number | null;
}) {
  return (
    <div className="print-area space-y-6">
      <WarningsPanel warnings={recipe.warnings} />

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-8">
        <section className="lg:sticky lg:top-[64px] lg:self-start lg:max-h-[calc(100vh-88px)] lg:overflow-y-auto rounded-[10px] lg:border lg:border-[hsl(var(--border-strong))] lg:bg-[hsl(var(--surface))] lg:p-4">
          <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))] mb-2">
            Ingredients
          </h2>
          <IngredientList
            ingredients={recipe.ingredients}
            unitSystem={unitSystem}
            scaleFactor={scaleFactor}
            warnings={recipe.warnings}
            onSeek={onSeek}
          />
        </section>

        <section className="space-y-6 min-w-0">
          <div>
            <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))] mb-2">
              Method
            </h2>
            <StepsList
              steps={recipe.steps}
              unitSystem={unitSystem}
              warnings={recipe.warnings}
              onSeek={onSeek}
              currentTime={currentTime}
            />
          </div>

          <TipsList tips={recipe.tips} onSeek={onSeek} />
        </section>
      </div>
    </div>
  );
}
