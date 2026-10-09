import { useState, type FormEvent } from "react";
import { Loader2, Mail, MailCheck } from "lucide-react";
import { account } from "@/backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import googleLogo from "@/assets/google-g.png";

/** Google sign-in and "Email me a sign-in link" — the two ways in (cloud mode). */
export function SignInPanel() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!account) return null;
  const acct = account;

  async function handleGoogle() {
    setBusy("google");
    setError(null);
    try {
      await acct.signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleEmail(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy("email");
    setError(null);
    try {
      await acct.sendSignInLink(trimmed);
      setSentTo(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the link. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (sentTo) {
    return (
      <div className="space-y-3 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
          <MailCheck className="h-4 w-4" />
        </span>
        <div className="space-y-1">
          <p className="font-medium text-[hsl(var(--ink))]">Check your inbox</p>
          <p className="text-sm text-[hsl(var(--ink-muted))]">
            We sent a sign-in link to <span className="text-[hsl(var(--ink))]">{sentTo}</span>. Open it
            on this device to sign in.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSentTo(null)}
          className="text-sm text-[hsl(var(--accent-text))] underline-offset-4 hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5">
      <div className="space-y-1">
        <p className="font-medium text-[hsl(var(--ink))]">Sign in to start</p>
        <p className="text-sm text-[hsl(var(--ink-muted))]">Free — 30 recipes a month.</p>
      </div>

      <Button className="w-full" onClick={handleGoogle} disabled={busy !== null}>
        {busy === "google" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <img src={googleLogo} alt="" aria-hidden="true" width={20} height={20} className="h-5 w-5 shrink-0" />
        )}
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-xs text-[hsl(var(--ink-faint))]">
        <span className="h-px flex-1 bg-[hsl(var(--border))]" />
        or
        <span className="h-px flex-1 bg-[hsl(var(--border))]" />
      </div>

      <form onSubmit={handleEmail} className="space-y-2">
        <label htmlFor="signin-email" className="sr-only">
          Email address
        </label>
        <Input
          id="signin-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" variant="outline" className="w-full" disabled={busy !== null || !email.trim()}>
          {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Email me a sign-in link
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-[hsl(var(--danger))]">
          {error}
        </p>
      )}
    </div>
  );
}
