import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { publicBank } from "@/backend";
import { termsHref } from "@/lib/router";
import { buildReportRequest, type ReportKind } from "@/lib/report";

export type { ReportKind };
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** "Report" and "Is this your video?" — both work signed out (the API needs only App Check). */
export function ReportDialog({
  open,
  onOpenChange,
  publicId,
  kind,
  channelName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicId: string;
  kind: ReportKind;
  channelName: string | null;
}) {
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setContact("");
    setError(null);
    setSent(false);
  }, [open, kind]);

  async function submit() {
    if (!publicBank) return;
    const built = buildReportRequest(kind, reason, contact);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await publicBank.report(publicId, built.body);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const claim = kind === "claim";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{claim ? "Is this your video?" : "Report this recipe"}</DialogTitle>
          <DialogDescription>
            {claim
              ? `If you're ${channelName ? channelName : "the creator"}, you can ask us to take this page down or to change how you're credited. We read every request and usually act within a few days; we may email you to confirm it's your channel.`
              : "Tell us what's wrong — spam, something unsafe, not a real recipe, or wrong credit. We review every report."}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-3">
            <p className="rounded-[10px] border border-[hsl(var(--accent-tint-strong))] bg-[hsl(var(--accent-tint))] px-4 py-3 text-sm text-[hsl(var(--accent-text))]">
              {claim ? "Thanks — we'll be in touch at the email you gave." : "Thanks — we'll take a look."}
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="report-reason" className="text-sm text-[hsl(var(--ink))]">
                  {claim ? "What would you like us to do?" : "What's wrong?"}
                </label>
                <Textarea
                  id="report-reason"
                  maxLength={2000}
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={claim ? "e.g. Please remove this page, or credit my other channel." : ""}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="report-contact" className="text-sm text-[hsl(var(--ink))]">
                  {claim ? "Your email" : "Your email (optional)"}
                </label>
                <Input
                  id="report-contact"
                  type="email"
                  autoComplete="email"
                  maxLength={200}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
                <p className="text-xs text-[hsl(var(--ink-faint))]">
                  Only we see it — never shown on the page.{" "}
                  <a href={termsHref()} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    How takedowns work
                  </a>
                </p>
              </div>
              {error && (
                <p role="alert" className="text-sm text-[hsl(var(--danger))]">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {claim ? "Send request" : "Send report"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
