import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, Pencil } from "lucide-react";
import { publicBank } from "@/backend";
import { displaySourceUrl, parseSourceUrl } from "@/lib/sourceUrl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The owner's private video/page link for a recipe (cloud mode): shown with a pencil to set,
 * change or clear it. Written straight to Firestore (recipes/{id}.sourceUrl — the rules allow
 * that field alone); prefills the Publish dialog.
 */
export function SourceLinkRow({
  recipeId,
  value,
  onChange,
}: {
  recipeId: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!publicBank) return null;
  const bank = publicBank;

  const parsed = parseSourceUrl(text);
  const inlineError = !parsed.ok && touched ? parsed.error : null;

  function startEdit() {
    setText(value ?? "");
    setTouched(false);
    setError(null);
    setEditing(true);
  }

  async function save(next: string | null) {
    setSaving(true);
    setError(null);
    try {
      await bank.setSourceUrl(recipeId, next);
      onChange(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the link. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    setTouched(true);
    if (!parsed.ok) return;
    if (parsed.url === value) {
      setEditing(false);
      return;
    }
    void save(parsed.url);
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link2 className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--ink-faint))]" />
        {value ? (
          <>
            <span className="text-[hsl(var(--ink-muted))]">Video:</span>
            <a
              href={value}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate text-[hsl(var(--accent-text))] underline-offset-4 hover:underline"
              title={value}
            >
              {displaySourceUrl(value)}
            </a>
            <button
              type="button"
              onClick={startEdit}
              aria-label="Edit the video link"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[hsl(var(--ink-faint))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 text-[hsl(var(--ink-muted))] underline-offset-4 hover:text-[hsl(var(--ink))] hover:underline"
          >
            Add the video link
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={`source-url-${recipeId}`} className="text-xs font-medium text-[hsl(var(--ink-muted))]">
        Link to the video <span className="font-normal text-[hsl(var(--ink-faint))]">(only you see it)</span>
      </label>
      <div className="space-y-2">
        <input
          ref={inputRef}
          id={`source-url-${recipeId}`}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://youtube.com/watch?v=…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          aria-invalid={inlineError ? true : undefined}
          className={cn(
            "block h-9 w-full min-w-[min(18rem,100%)] rounded-[var(--radius-control)] border bg-[hsl(var(--surface))] px-3 text-sm text-[hsl(var(--ink))] placeholder:text-[hsl(var(--ink-faint))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
            inlineError ? "border-[hsl(var(--danger))]" : "border-[hsl(var(--border-strong))]",
          )}
        />
        <div className="flex items-center gap-1.5">
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
          {value && (
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void save(null)}>
              Remove
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
      {(inlineError || error) && (
        <p role="alert" className="text-xs text-[hsl(var(--danger))]">
          {inlineError ?? error}
        </p>
      )}
    </form>
  );
}
