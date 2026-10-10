import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Globe, Loader2, RefreshCw, Settings2, Undo2 } from "lucide-react";
import type { PublicRecipe } from "@recipe/shared";
import { account, publicBank } from "@/backend";
import { hasUnpublishedChanges, updateRequestFromSnapshot } from "@/lib/publish";
import { publicHref } from "@/lib/router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PublishDialog } from "./PublishDialog";
import { PublicStatusPill } from "./PublicStatusPill";

/**
 * The recipe page's publishing row (cloud mode, owner): "Publish…" before publishing; after,
 * the status pill, a link to the public page, Update public version (when the private recipe
 * has newer edits), details, and Unpublish. The snapshot is read from Firestore
 * (publicRecipes/{same id}); the owner can read it in any status.
 */
export function PublishControls({ recipeId, privateVersion }: { recipeId: string; privateVersion: number | null }) {
  const [pub, setPub] = useState<PublicRecipe | null | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [needsHandle, setNeedsHandle] = useState(false);
  const [busy, setBusy] = useState<"update" | "unpublish" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  const load = useCallback(() => {
    if (!publicBank) return;
    publicBank
      .getPublicRecipe(recipeId)
      .then(setPub)
      .catch(() => setPub(null));
  }, [recipeId]);

  useEffect(() => {
    setPub(undefined);
    setError(null);
    load();
  }, [load]);

  if (!publicBank || pub === undefined) return null;
  const bank = publicBank;

  async function openDialog() {
    setError(null);
    setBusy("open");
    try {
      const me = account ? await account.getMe() : null;
      setNeedsHandle(!me?.handle);
    } catch {
      // Unknown — ask for one; the API ignores it when the account already has a handle.
      setNeedsHandle(true);
    } finally {
      setBusy(null);
    }
    setDialogOpen(true);
  }

  async function updatePublic() {
    if (!pub) return;
    setBusy("update");
    setError(null);
    try {
      setPub(await bank.publish(recipeId, updateRequestFromSnapshot(pub)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the public version.");
    } finally {
      setBusy(null);
    }
  }

  async function unpublish() {
    setBusy("unpublish");
    setError(null);
    try {
      await bank.unpublish(recipeId);
      setPub(null);
      setConfirmUnpublish(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't unpublish. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const newer = hasUnpublishedChanges(privateVersion, pub);

  return (
    <div className="no-print space-y-1.5">
      {pub === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={openDialog} disabled={busy === "open"}>
            {busy === "open" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
            Publish…
          </Button>
          <span className="text-xs text-[hsl(var(--ink-faint))]">Share it in the public recipe bank, with credit.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PublicStatusPill pub={pub} />
          <a
            href={publicHref(recipeId)}
            className="inline-flex items-center gap-1 text-sm text-[hsl(var(--accent-text))] underline-offset-4 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Public page
          </a>
          <Button
            size="sm"
            variant={newer ? "default" : "outline"}
            onClick={updatePublic}
            disabled={!newer || busy !== null}
            title={newer ? "Publish your latest edits" : "The public page already shows your latest version"}
          >
            {busy === "update" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Update public version
          </Button>
          <Button size="sm" variant="ghost" onClick={openDialog} disabled={busy !== null}>
            <Settings2 className="h-3.5 w-3.5" /> Details
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmUnpublish(true)} disabled={busy !== null}>
            <Undo2 className="h-3.5 w-3.5" /> Unpublish
          </Button>
        </div>
      )}
      {pub && newer && (
        <p className="text-xs text-[hsl(var(--ink-faint))]">Your latest edits aren't public yet.</p>
      )}
      {pub && pub.status === "review" && (
        <p className="text-xs text-[hsl(var(--ink-faint))]">
          Our automatic check flagged this for a quick human look. Only you can see it until then.
        </p>
      )}
      {pub && pub.status === "hidden" && (
        <p className="text-xs text-[hsl(var(--ink-faint))]">
          Hidden after a report or a creator's request. Only you can see it.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[hsl(var(--danger))]">
          {error}
        </p>
      )}

      <PublishDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        recipeId={recipeId}
        existing={pub}
        needsHandle={needsHandle}
        onPublished={(p) => {
          setPub(p);
          // The handle is now set; refresh the cached /me next time.
          void account?.getMe({ fresh: true }).catch(() => undefined);
        }}
      />

      <Dialog open={confirmUnpublish} onOpenChange={setConfirmUnpublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpublish this recipe?</DialogTitle>
            <DialogDescription>
              It's removed from the public recipe bank right away, and its link stops working. People who saved it will
              see “no longer available”. Your private recipe stays as it is.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={unpublish} disabled={busy === "unpublish"}>
              {busy === "unpublish" ? "Unpublishing…" : "Unpublish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
