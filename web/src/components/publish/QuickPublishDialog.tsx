import { useEffect, useState } from "react";
import type { PublicRecipe } from "@recipe/shared";
import { account, publicBank } from "@/backend";
import { PublishDialog } from "./PublishDialog";

/**
 * Opens the Publish dialog for a recipe from outside its page (the Library's "Share your first
 * recipe" card): looks up whether the account still needs a handle and the recipe's saved video
 * link (which prefills the source) first.
 */
export function QuickPublishDialog({
  recipeId,
  onClose,
  onPublished,
}: {
  /** The recipe to publish; null = closed. */
  recipeId: string | null;
  onClose: () => void;
  onPublished: (pub: PublicRecipe) => void;
}) {
  const [ready, setReady] = useState<{ id: string; needsHandle: boolean; sourceUrl: string | null } | null>(null);

  useEffect(() => {
    if (!recipeId) {
      setReady(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [me, sourceUrl] = await Promise.all([
        account ? account.getMe().catch(() => null) : Promise.resolve(null),
        publicBank ? publicBank.getSourceUrl(recipeId).catch(() => null) : Promise.resolve(null),
      ]);
      if (!cancelled) setReady({ id: recipeId, needsHandle: !me?.handle, sourceUrl });
    })();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  if (!ready || ready.id !== recipeId) return null;
  return (
    <PublishDialog
      open
      onOpenChange={(open) => !open && onClose()}
      recipeId={ready.id}
      existing={null}
      needsHandle={ready.needsHandle}
      sourceUrl={ready.sourceUrl}
      onPublished={(pub) => {
        onPublished(pub);
        void account?.getMe({ fresh: true }).catch(() => undefined);
      }}
    />
  );
}
