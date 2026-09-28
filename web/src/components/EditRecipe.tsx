import { useState } from "react";
import type { Recipe, Ingredient, Step, Tip } from "@recipe/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, ArrowUp, ArrowDown, Save, X } from "lucide-react";
import {
  buildIndexMap,
  remapWarningTargets,
  applyUserConfirmedIngredients,
} from "@/lib/remapWarnings";

function blankIngredient(): Ingredient {
  return {
    quantity: null,
    unit: null,
    item: "",
    prep: null,
    sourceText: "",
    timestamp: null,
    confidence: "stated",
  };
}

function blankStep(): Step {
  return { text: "", timestamp: null, durationMinutes: null, temperature: null };
}

function blankTip(): Tip {
  return { text: "", timestamp: null };
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function EditRecipe({
  recipe,
  onCancel,
  onSave,
  saving,
}: {
  recipe: Recipe;
  onCancel: () => void;
  onSave: (recipe: Recipe) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Recipe>(() => structuredClone(recipe));

  // Stable client-side identity for each row: the index it had in the
  // original recipe passed in, or null for a row added during this edit
  // session. Kept in lockstep with draft.ingredients/draft.steps (same
  // length, same reordering) but never persisted onto the saved Recipe.
  const [ingredientOrigIndex, setIngredientOrigIndex] = useState<Array<number | null>>(() =>
    recipe.ingredients.map((_, i) => i),
  );
  const [stepOrigIndex, setStepOrigIndex] = useState<Array<number | null>>(() =>
    recipe.steps.map((_, i) => i),
  );
  // Original indexes of ingredients whose quantity/unit/item the user changed.
  const [editedIngredientOrigIndexes, setEditedIngredientOrigIndexes] = useState<Set<number>>(
    () => new Set(),
  );

  function set<K extends keyof Recipe>(key: K, value: Recipe[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setIngredients(next: Ingredient[], nextOrigIndex: Array<number | null>) {
    set("ingredients", next);
    setIngredientOrigIndex(nextOrigIndex);
  }

  function setSteps(next: Step[], nextOrigIndex: Array<number | null>) {
    set("steps", next);
    setStepOrigIndex(nextOrigIndex);
  }

  function markIngredientEdited(i: number) {
    const orig = ingredientOrigIndex[i];
    if (orig === null) return; // newly-added row: nothing to confirm against
    setEditedIngredientOrigIndexes((prev) => {
      const next = new Set(prev);
      next.add(orig);
      return next;
    });
  }

  function handleSave() {
    const ingredientIndexMap = buildIndexMap(ingredientOrigIndex);
    const stepIndexMap = buildIndexMap(stepOrigIndex);
    const remapped = remapWarningTargets(draft.warnings, {
      ingredients: ingredientIndexMap,
      steps: stepIndexMap,
    });
    const { ingredients, warnings } = applyUserConfirmedIngredients(
      draft.ingredients,
      remapped,
      editedIngredientOrigIndexes,
      ingredientIndexMap,
    );
    onSave({ ...draft, ingredients, warnings });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">Title</label>
          <Input value={draft.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium">Description</label>
          <Textarea
            value={draft.description ?? ""}
            onChange={(e) => set("description", e.target.value || null)}
          />
        </div>
        <div className="flex gap-4">
          <div>
            <label className="text-sm font-medium">Servings</label>
            <Input
              type="number"
              min={0}
              value={draft.servings ?? ""}
              onChange={(e) =>
                set("servings", e.target.value === "" ? null : Number(e.target.value))
              }
              className="w-28"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Total time (min)</label>
            <Input
              type="number"
              min={0}
              value={draft.totalTimeMinutes ?? ""}
              onChange={(e) =>
                set("totalTimeMinutes", e.target.value === "" ? null : Number(e.target.value))
              }
              className="w-28"
            />
          </div>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="font-medium">Ingredients</h3>
        <div className="space-y-2">
          {draft.ingredients.map((ing, i) => (
            <div
              key={i}
              className="grid grid-cols-[5rem_5rem_1fr_1fr_auto] gap-2 items-start rounded-md border border-[hsl(var(--border))] p-2"
            >
              <Input
                aria-label="Quantity"
                placeholder="qty"
                type="number"
                value={ing.quantity ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setIngredients(
                    draft.ingredients.map((it, idx) => (idx === i ? { ...it, quantity: v } : it)),
                    ingredientOrigIndex,
                  );
                  markIngredientEdited(i);
                }}
              />
              <Input
                aria-label="Unit"
                placeholder="unit"
                value={ing.unit ?? ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setIngredients(
                    draft.ingredients.map((it, idx) => (idx === i ? { ...it, unit: v } : it)),
                    ingredientOrigIndex,
                  );
                  markIngredientEdited(i);
                }}
              />
              <Input
                aria-label="Item"
                placeholder="item"
                value={ing.item}
                onChange={(e) => {
                  const v = e.target.value;
                  setIngredients(
                    draft.ingredients.map((it, idx) => (idx === i ? { ...it, item: v } : it)),
                    ingredientOrigIndex,
                  );
                  markIngredientEdited(i);
                }}
              />
              <Input
                aria-label="Prep"
                placeholder="prep (optional)"
                value={ing.prep ?? ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setIngredients(
                    draft.ingredients.map((it, idx) => (idx === i ? { ...it, prep: v } : it)),
                    ingredientOrigIndex,
                  );
                }}
              />
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move up"
                  onClick={() =>
                    setIngredients(
                      move(draft.ingredients, i, i - 1),
                      move(ingredientOrigIndex, i, i - 1),
                    )
                  }
                  disabled={i === 0}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move down"
                  onClick={() =>
                    setIngredients(
                      move(draft.ingredients, i, i + 1),
                      move(ingredientOrigIndex, i, i + 1),
                    )
                  }
                  disabled={i === draft.ingredients.length - 1}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove ingredient"
                  onClick={() =>
                    setIngredients(
                      draft.ingredients.filter((_, idx) => idx !== i),
                      ingredientOrigIndex.filter((_, idx) => idx !== i),
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setIngredients([...draft.ingredients, blankIngredient()], [...ingredientOrigIndex, null])
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add ingredient
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Steps</h3>
        <div className="space-y-2">
          {draft.steps.map((step, i) => (
            <div
              key={i}
              className="flex gap-2 items-start rounded-md border border-[hsl(var(--border))] p-2"
            >
              <span className="mt-2 text-sm font-semibold text-[hsl(var(--muted-foreground))]">
                {i + 1}
              </span>
              <Textarea
                aria-label={`Step ${i + 1} text`}
                value={step.text}
                onChange={(e) =>
                  setSteps(
                    draft.steps.map((s, idx) => (idx === i ? { ...s, text: e.target.value } : s)),
                    stepOrigIndex,
                  )
                }
                className="flex-1"
              />
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move up"
                  onClick={() => setSteps(move(draft.steps, i, i - 1), move(stepOrigIndex, i, i - 1))}
                  disabled={i === 0}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move down"
                  onClick={() => setSteps(move(draft.steps, i, i + 1), move(stepOrigIndex, i, i + 1))}
                  disabled={i === draft.steps.length - 1}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove step"
                  onClick={() =>
                    setSteps(
                      draft.steps.filter((_, idx) => idx !== i),
                      stepOrigIndex.filter((_, idx) => idx !== i),
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSteps([...draft.steps, blankStep()], [...stepOrigIndex, null])}
        >
          <Plus className="h-3.5 w-3.5" /> Add step
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Tips</h3>
        <div className="space-y-2">
          {draft.tips.map((tip, i) => (
            <div key={i} className="flex gap-2 items-start rounded-md border border-[hsl(var(--border))] p-2">
              <Input
                aria-label={`Tip ${i + 1}`}
                value={tip.text}
                onChange={(e) =>
                  set(
                    "tips",
                    draft.tips.map((t, idx) => (idx === i ? { ...t, text: e.target.value } : t)),
                  )
                }
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove tip"
                onClick={() => set("tips", draft.tips.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => set("tips", [...draft.tips, blankTip()])}>
          <Plus className="h-3.5 w-3.5" /> Add tip
        </Button>
      </section>

      <div className="no-print sticky bottom-16 flex justify-end gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-md">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
