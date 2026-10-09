import { useEffect, useState } from "react";
import { Loader2, FolderInput } from "lucide-react";
import { account, type AccountUser } from "@/backend";
import { dismissMovePrompt, isMovePromptDismissed } from "@/lib/accountPrefs";
import { Button } from "@/components/ui/button";

/**
 * First sign-in on a browser that already has recipes from the old local library (same
 * IndexedDB): offer to move them into the account. Doesn't count against the monthly limit;
 * "Not now" is remembered per account (Settings → Account can still move them later).
 */
export function MoveLocalRecipesPrompt({ user, onMoved }: { user: AccountUser; onMoved: () => void }) {
  const [count, setCount] = useState(0);
  const [moving, setMoving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account || isMovePromptDismissed(user.uid)) return;
    let cancelled = false;
    account
      .countLocalRecipes()
      .then((n) => !cancelled && setCount(n))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  if (result) {
    return (
      <p className="rounded-[10px] border border-[hsl(var(--accent-tint-strong))] bg-[hsl(var(--accent-tint))] px-4 py-3 text-sm text-[hsl(var(--accent-text))]">
        {result}
      </p>
    );
  }
  if (count === 0) return null;

  async function handleMove() {
    if (!account) return;
    setMoving(true);
    setError(null);
    try {
      const { imported } = await account.moveLocalRecipes();
      dismissMovePrompt(user.uid);
      setResult(`Moved ${imported} recipe${imported === 1 ? "" : "s"} into your account.`);
      onMoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't move your recipes. Please try again.");
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-[hsl(var(--caution-border))] bg-[hsl(var(--caution-tint))] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <FolderInput className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--caution-icon))]" />
        <div className="space-y-0.5">
          <p className="font-medium text-[hsl(var(--ink))]">
            Move your {count} recipe{count === 1 ? "" : "s"} into your account?
          </p>
          <p className="text-sm text-[hsl(var(--caution-text))]">
            {count === 1 ? "It was" : "They were"} made in this browser before you signed in. Moving doesn't
            count toward your monthly recipes, and the audio stays on this device.
          </p>
          {error && (
            <p role="alert" className="text-sm text-[hsl(var(--danger))]">
              {error}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2 pl-7 sm:pl-0">
        <Button size="sm" onClick={handleMove} disabled={moving}>
          {moving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Move
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={moving}
          onClick={() => {
            dismissMovePrompt(user.uid);
            setCount(0);
          }}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
