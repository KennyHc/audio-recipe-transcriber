import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { account } from "@/backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function leaveLanding() {
  window.history.replaceState(null, "", `${window.location.pathname}#/`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * Where an emailed sign-in link lands (cloud mode). Completes the sign-in with the email this
 * browser remembered; on another device (nothing remembered) it asks for the email first.
 */
export function EmailLinkLanding({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(() => account?.storedSignInEmail() ?? "");
  const [needsEmail, setNeedsEmail] = useState(() => !account?.storedSignInEmail());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  async function complete(address: string) {
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      await account.completeSignInLink(address, window.location.href);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
      setNeedsEmail(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoStarted.current || needsEmail || !email) return;
    autoStarted.current = true;
    void complete(email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (email.trim()) void complete(email.trim());
  }

  return (
    <div className="mx-auto max-w-[440px] px-4 py-14">
      <div className="space-y-4 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
          <MailCheck className="h-4 w-4" />
        </span>
        {needsEmail ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <h1 className="font-serif text-[30px] leading-[1.05] text-[hsl(var(--ink))]">Confirm your email</h1>
              <p className="text-sm text-[hsl(var(--ink-muted))]">
                You opened the sign-in link on a different device or browser. Enter the email you
                asked for it with.
              </p>
            </div>
            <label htmlFor="confirm-email" className="sr-only">
              Email address
            </label>
            <Input
              id="confirm-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>
        ) : (
          <div className="space-y-1">
            <h1 className="font-serif text-[30px] leading-[1.05] text-[hsl(var(--ink))]">Signing you in…</h1>
            <p className="flex items-center gap-2 text-sm text-[hsl(var(--ink-muted))]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> One moment.
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-[hsl(var(--danger))]">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            leaveLanding();
            onDone();
          }}
          className="text-sm text-[hsl(var(--ink-muted))] underline-offset-4 hover:text-[hsl(var(--ink))] hover:underline"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}
