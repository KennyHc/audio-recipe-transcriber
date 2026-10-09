import { useEffect, useRef, useState } from "react";
import { Download, Loader2, LogOut, Trash2, Upload, FolderInput } from "lucide-react";
import type { MeResponse } from "@recipe/shared";
import { account, backend, type AccountUser } from "@/backend";
import { quotaExceededMessage, formatResetDate } from "@/backend/cloud/errors";
import { noteAccountDeleted } from "@/lib/accountPrefs";
import { navigate } from "@/lib/router";
import { Avatar } from "@/components/account/AccountMenu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function usageSummary(me: MeResponse): string {
  const resets = new Date(me.usage.resetsAt);
  if (me.usage.remaining <= 0) return quotaExceededMessage(me.usage.limit, resets);
  return `${me.usage.used} of ${me.usage.limit} used this month · resets ${formatResetDate(resets)}`;
}

const sectionClass = "space-y-4 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 sm:p-6";
const labelClass = "text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]";

/** Settings → Account (cloud mode): who, plan + usage, data export/import, delete account. */
export function AccountSection({ user }: { user: AccountUser }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  const [includeAudio, setIncludeAudio] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dataNote, setDataNote] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [localCount, setLocalCount] = useState(0);
  const [moving, setMoving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteNote, setDeleteNote] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    account
      .getMe({ fresh: true })
      .then(setMe)
      .catch((err: unknown) => setMeError(err instanceof Error ? err.message : "Usage unavailable right now."));
    account
      .countLocalRecipes()
      .then(setLocalCount)
      .catch(() => undefined);
  }, [user.uid]);

  const confirmTarget = (user.email ?? "DELETE").toLowerCase();
  const confirmMatches = confirmText.trim().toLowerCase() === confirmTarget;

  async function handleExport() {
    setExporting(true);
    setDataError(null);
    setDataNote(null);
    try {
      const blob = await backend.exportLibrary({ includeAudio });
      downloadBlob(blob, `recipes-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : "Couldn't create the file.");
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    setDataError(null);
    setDataNote(null);
    try {
      const { imported, skipped } = await backend.importLibrary(file);
      const parts = [`Added ${imported} recipe${imported === 1 ? "" : "s"} to your account`];
      if (skipped > 0) parts.push(`skipped ${skipped} already there`);
      setDataNote(parts.join(", ") + ".");
    } catch (err) {
      setDataError(err instanceof Error ? err.message : "Couldn't import that file.");
    } finally {
      setImporting(false);
    }
  }

  async function handleMove() {
    if (!account) return;
    setMoving(true);
    setDataError(null);
    setDataNote(null);
    try {
      const { imported } = await account.moveLocalRecipes();
      setDataNote(`Moved ${imported} recipe${imported === 1 ? "" : "s"} into your account.`);
      setLocalCount(await account.countLocalRecipes());
    } catch (err) {
      setDataError(err instanceof Error ? err.message : "Couldn't move your recipes.");
    } finally {
      setMoving(false);
    }
  }

  async function handleDelete() {
    if (!account || !confirmMatches) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { status } = await account.deleteAccount();
      if (status === "check_email") {
        setDeleteNote(
          `To confirm it's you, we emailed a sign-in link to ${user.email}. Open it, then delete your account again.`,
        );
        return;
      }
      noteAccountDeleted();
      setDeleteOpen(false);
      navigate("#/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete your account. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <section className={sectionClass}>
        <h2 className={labelClass}>Account</h2>
        <div className="flex items-center gap-3">
          <Avatar user={user} size={40} />
          <div className="min-w-0">
            {user.displayName && <p className="truncate font-medium text-[hsl(var(--ink))]">{user.displayName}</p>}
            <p className="truncate text-sm text-[hsl(var(--ink-muted))]">{user.email ?? "Signed in"}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-[hsl(var(--ink-muted))]">Plan</dt>
          <dd className="text-[hsl(var(--ink))]">Free — {me?.usage.limit ?? 30} recipes a month</dd>
          <dt className="text-[hsl(var(--ink-muted))]">Usage</dt>
          <dd className="tabular-nums text-[hsl(var(--ink))]">{me ? usageSummary(me) : meError ?? "Checking…"}</dd>
        </dl>
        <Button
          variant="outline"
          onClick={() => {
            void account?.signOut().then(() => navigate("#/"));
          }}
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </Button>
      </section>

      <section className={sectionClass}>
        <h2 className={labelClass}>Your data</h2>
        <p className="text-sm text-[hsl(var(--ink-muted))]">
          Download everything in your account — every recipe, version, and transcript — as one file
          you can keep or import again.
        </p>
        <div className="space-y-2.5">
          <label className="checkbox-row flex items-center gap-2.5 text-sm text-[hsl(var(--ink))]">
            <Checkbox
              checked={includeAudio}
              onChange={() => setIncludeAudio((v) => !v)}
              ariaLabel="Include audio stored on this device"
            />
            Include audio stored on this device (larger file)
          </label>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download all my data
          </Button>
        </div>

        <div className="space-y-2.5 border-t border-[hsl(var(--border))] pt-4">
          <p className="text-sm font-medium text-[hsl(var(--ink))]">Import a backup file</p>
          <p className="text-sm text-[hsl(var(--ink-muted))]">
            Adds the recipes from a backup to your account. Doesn't count toward your monthly recipes;
            any audio in the file stays on this device.
          </p>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleImport(file);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => importInputRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Choose backup file…
            </Button>
            {localCount > 0 && (
              <Button variant="outline" onClick={handleMove} disabled={moving}>
                {moving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
                Move {localCount} recipe{localCount === 1 ? "" : "s"} from this browser
              </Button>
            )}
          </div>
        </div>
        {dataNote && <p className="text-sm text-[hsl(var(--accent-text))]">{dataNote}</p>}
        {dataError && (
          <p role="alert" className="text-sm text-[hsl(var(--danger))]">
            {dataError}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-[10px] border border-[hsl(var(--danger))]/30 bg-[hsl(var(--surface))] p-5 sm:p-6">
        <h2 className={labelClass}>Delete account</h2>
        <p className="text-sm text-[hsl(var(--ink-muted))]">
          Permanently deletes your account and every recipe, version, and transcript in it, and clears
          this browser's local data. Download your data first if you want to keep it. This can't be
          undone.
        </p>
        <Button
          variant="destructive"
          onClick={() => {
            setConfirmText("");
            setDeleteError(null);
            setDeleteNote(null);
            setDeleteOpen(true);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete my account
        </Button>
      </section>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This deletes every recipe, version, and transcript in your account, then signs you out.
              It can't be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="delete-confirm" className="text-sm text-[hsl(var(--ink))]">
              Type <span className="font-medium">{user.email ?? "DELETE"}</span> to confirm
            </label>
            <Input
              id="delete-confirm"
              autoComplete="off"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            {deleteNote && <p className="text-sm text-[hsl(var(--accent-text))]">{deleteNote}</p>}
            {deleteError && (
              <p role="alert" className="text-sm text-[hsl(var(--danger))]">
                {deleteError}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={!confirmMatches || deleting}>
              {deleting ? "Deleting…" : "Delete my account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
