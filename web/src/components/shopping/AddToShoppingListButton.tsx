import { useEffect, useRef, useState } from "react";
import { Check, Loader2, ShoppingBasket } from "lucide-react";
import type { Ingredient } from "@recipe/shared";
import { shoppingList } from "@/backend";
import { addRecipeToList, addResultMessage } from "@/lib/shopping";
import { shoppingListHref } from "@/lib/router";
import { IS_CLOUD } from "@/lib/mode";
import { useAccountUser } from "@/lib/useAccount";
import { cn } from "@/lib/utils";

/**
 * "Add to shopping list" for a recipe's ingredients at the servings scale on screen. Shows a short
 * confirmation toast ("Added 12 items — 2 merged · View list"). In cloud mode, signed out, it asks
 * the page to prompt for sign-in instead (`onNeedSignIn`).
 */
export function AddToShoppingListButton({
  recipeId,
  title,
  isPublic,
  ingredients,
  scaleFactor,
  onNeedSignIn,
  className,
}: {
  recipeId: string;
  title: string;
  isPublic: boolean;
  ingredients: Ingredient[];
  scaleFactor: number;
  onNeedSignIn?: () => void;
  className?: string;
}) {
  const user = useAccountUser();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function show(text: string, tone: "ok" | "error") {
    setToast({ text, tone });
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 6000);
  }

  async function add() {
    if (IS_CLOUD && user === null) {
      onNeedSignIn?.();
      return;
    }
    setBusy(true);
    try {
      const result = await shoppingList.update((list) =>
        addRecipeToList(list, { recipeId, title, isPublic, ingredients, scaleFactor }),
      );
      if (result) show(addResultMessage(result), result.added === 0 && result.skipped > 0 ? "error" : "ok");
    } catch (err) {
      show(err instanceof Error && err.message ? err.message : "Couldn't add to your list. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={add}
        disabled={busy || ingredients.length === 0}
        className={cn(
          "no-print inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-sm font-medium text-[hsl(var(--accent-text))] transition-colors hover:bg-[hsl(var(--accent-tint))] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
          className,
        )}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBasket className="h-3.5 w-3.5" />}
        Add to shopping list
      </button>
      <div aria-live="polite" className="no-print">
        {toast && (
          <div
            role="status"
            className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-[10px] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface))] px-4 py-3 text-sm text-[hsl(var(--ink))]"
            style={{ boxShadow: "var(--shadow-float)" }}
          >
            {toast.tone === "ok" ? (
              <Check className="h-4 w-4 shrink-0 text-[hsl(var(--accent-fill))]" />
            ) : (
              <ShoppingBasket className="h-4 w-4 shrink-0 text-[hsl(var(--danger))]" />
            )}
            <span className="min-w-0 flex-1">{toast.text}</span>
            <a
              href={shoppingListHref()}
              className="shrink-0 font-medium text-[hsl(var(--accent-text))] underline-offset-4 hover:underline"
            >
              View list
            </a>
          </div>
        )}
      </div>
    </>
  );
}
