import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Globe, Link2, Loader2, PlayCircle, Sparkles, User, Video } from "lucide-react";
import {
  MAX_TAGS,
  TAGS,
  type PublicRecipe,
  type PublishSuggestionsResponse,
  type SourcePreview,
} from "@recipe/shared";
import { publicBank } from "@/backend";
import { CloudApiError } from "@/backend/cloud/errors";
import {
  EMPTY_FORM,
  applySuggestedTags,
  autoSelectedTags,
  buildPublishRequest,
  createSuggestionsLoader,
  detectVideo,
  formFromSnapshot,
  formFromSourceUrl,
  handleProblem,
  normalizeHandle,
  normalizeUrl,
  parseOffset,
  shouldPreview,
  suggestionKey,
  suggestionSourceUrl,
  tagLabel,
  toggleTag,
  TAG_GROUP_LABELS,
  type PublishForm,
  type SourceKind,
  type SuggestionsLoader,
} from "@/lib/publish";
import { publicHref, termsHref } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SECTION_LABEL = "text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]";
const PREVIEW_DEBOUNCE_MS = 500;
const SUGGEST_DEBOUNCE_MS = 400;

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; url: string }
  | { status: "ready"; url: string; preview: SourcePreview }
  | { status: "error"; url: string; message: string };

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon: ReactNode }>;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left text-sm transition-colors",
            value === o.value
              ? "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint))] text-[hsl(var(--ink))]"
              : "border-[hsl(var(--border-strong))] text-[hsl(var(--ink-muted))] hover:bg-[hsl(var(--accent-tint))]",
          )}
        >
          <span className="text-[hsl(var(--accent-text))]">{o.icon}</span>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function VisibilityOption({
  checked,
  onSelect,
  title,
  text,
  icon,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  text: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-2.5 rounded-[10px] border p-3 text-left transition-colors",
        checked
          ? "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint))]"
          : "border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--accent-tint))]",
      )}
    >
      <span className="mt-0.5 text-[hsl(var(--accent-text))]">{icon}</span>
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-[hsl(var(--ink))]">{title}</span>
        <span className="block text-xs text-[hsl(var(--ink-muted))]">{text}</span>
      </span>
    </button>
  );
}

export function SourcePreviewCard({ preview }: { preview: SourcePreview }) {
  return (
    <div className="flex gap-3 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] p-2.5">
      {preview.thumbnailUrl ? (
        <img
          src={preview.thumbnailUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-16 w-28 shrink-0 rounded-[6px] object-cover"
        />
      ) : (
        <span className="flex h-16 w-28 shrink-0 items-center justify-center rounded-[6px] bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
          <PlayCircle className="h-6 w-6" />
        </span>
      )}
      <div className="min-w-0 space-y-0.5 py-0.5">
        {preview.title && <p className="line-clamp-2 text-sm font-medium text-[hsl(var(--ink))]">{preview.title}</p>}
        {preview.channelName && (
          <p className="text-xs text-[hsl(var(--ink-muted))]">
            Recipe by <span className="font-medium text-[hsl(var(--ink))]">{preview.channelName}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** Non-blocking "is that the right link?" note from the suggestions call. */
function CreditWarning({ text }: { text: string }) {
  // The API's text names the linked video ("This video is “…” — is that the right link?"), and
  // it sits right under the preview card with the video's title and thumbnail.
  return (
    <div
      role="status"
      className="flex gap-2 rounded-[10px] border border-[hsl(var(--caution-border))] bg-[hsl(var(--caution-tint))] px-3 py-2.5 text-sm text-[hsl(var(--caution-text))]"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--caution-icon))]" />
      <div className="min-w-0 space-y-0.5">
        <p>{text}</p>
        <p className="text-xs text-[hsl(var(--ink-muted))]">You can still publish — just check it's the video this recipe is from.</p>
      </div>
    </div>
  );
}

export interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeId: string;
  /** The current snapshot when re-publishing with new details. */
  existing: PublicRecipe | null;
  /** The account has no handle yet (first publish). */
  needsHandle: boolean;
  onPublished: (pub: PublicRecipe) => void;
  /** "fixSource": opened from "Change source" on a recipe held in review (focuses the link). */
  intent?: "details" | "fixSource";
  /** The recipe's saved video/page link; prefills the source when there's no snapshot yet. */
  sourceUrl?: string | null;
}

export function PublishDialog({
  open,
  onOpenChange,
  recipeId,
  existing,
  needsHandle,
  onPublished,
  intent = "details",
  sourceUrl = null,
}: PublishDialogProps) {
  const [form, setForm] = useState<PublishForm>(EMPTY_FORM);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [handleTouched, setHandleTouched] = useState(false);
  const previewSeq = useRef(0);
  // Suggestions: one call per distinct source URL per opening; failures are ignored.
  const [suggestions, setSuggestions] = useState<{ key: string; res: PublishSuggestionsResponse } | null>(null);
  const suggestLoader = useRef<SuggestionsLoader<PublishSuggestionsResponse> | null>(null);
  const tagsTouched = useRef(false);
  const firstPublish = useRef(existing === null);

  // Fresh form each time it opens (pre-filled when editing a published recipe).
  useEffect(() => {
    if (!open) return;
    setForm(existing ? formFromSnapshot(existing, needsHandle) : formFromSourceUrl(sourceUrl, needsHandle));
    setPreview({ status: "idle" });
    setError(null);
    setDuplicateId(null);
    setHandleError(null);
    setHandleTouched(false);
    setSuggestions(null);
    suggestLoader.current = publicBank
      ? createSuggestionsLoader((url) => publicBank!.publishSuggestions(recipeId, url))
      : null;
    tagsTouched.current = false;
    firstPublish.current = existing === null;
  }, [open, existing, needsHandle, recipeId, sourceUrl]);

  const update = (patch: Partial<PublishForm>) => setForm((f) => ({ ...f, ...patch }));
  const setTags = (tags: string[]) => {
    tagsTouched.current = true;
    update({ tags });
  };

  // Live preview for YouTube/TikTok links (debounced). Credit comes from the API's oEmbed lookup.
  const previewUrl = form.sourceKind === "video" && shouldPreview(form.videoUrl) ? normalizeUrl(form.videoUrl) : null;
  useEffect(() => {
    if (!open || !previewUrl || !publicBank) {
      setPreview({ status: "idle" });
      return;
    }
    const seq = ++previewSeq.current;
    setPreview({ status: "loading", url: previewUrl });
    const timer = setTimeout(() => {
      publicBank!
        .previewSource(previewUrl)
        .then((p) => {
          if (seq === previewSeq.current) setPreview({ status: "ready", url: previewUrl, preview: p });
        })
        .catch((err: unknown) => {
          if (seq !== previewSeq.current) return;
          setPreview({
            status: "error",
            url: previewUrl,
            message: err instanceof Error ? err.message : "We couldn't find that video — is it public?",
          });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, previewUrl]);

  // Suggested tags + a wrong-link check, once the source is known (the preview's canonical URL
  // for YouTube/TikTok; the typed link otherwise; null for "My own recipe").
  const suggestUrl = suggestionSourceUrl(form, preview.status === "ready" ? preview.preview.url : null);
  const currentSuggestKey = suggestUrl === undefined ? null : suggestionKey(suggestUrl);
  useEffect(() => {
    const loader = suggestLoader.current;
    if (!open || suggestUrl === undefined || !loader) return;
    const key = suggestionKey(suggestUrl);
    let cancelled = false;
    const timer = setTimeout(() => {
      void loader.load(suggestUrl).then((res) => {
        if (cancelled || !res) return; // stale (the link changed) or failed — ignore
        setSuggestions({ key, res });
        const auto = autoSelectedTags({
          firstPublish: firstPublish.current,
          userTouchedTags: tagsTouched.current,
          suggested: res.tags,
        });
        if (auto) setForm((f) => ({ ...f, tags: auto }));
      });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // suggestUrl is captured by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentSuggestKey]);

  const creditWarning =
    suggestions && suggestions.key === currentSuggestKey && form.sourceKind !== "own" ? suggestions.res.creditWarning : null;
  const suggestedTags = suggestions?.res.tags ?? [];
  const canUseSuggested =
    suggestedTags.some((t) => !form.tags.includes(t)) && form.tags.length < MAX_TAGS;

  const detected = form.sourceKind === "video" ? detectVideo(form.videoUrl) : null;
  const offsetInvalid = form.sourceKind === "video" && parseOffset(form.offsetText) === null;
  const handleHint = form.needsHandle && (handleTouched || form.handle) ? handleProblem(form.handle) : null;
  const existingInBank =
    preview.status === "ready" && preview.preview.existingPublicId && preview.preview.existingPublicId !== recipeId
      ? preview.preview.existingPublicId
      : null;
  const duplicateBlocked = existingInBank !== null && form.visibility === "public";

  const built = useMemo(() => buildPublishRequest(form), [form]);

  async function submit() {
    if (!publicBank) return;
    setError(null);
    setDuplicateId(null);
    setHandleError(null);
    setHandleTouched(true);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    if (duplicateBlocked) {
      setError("This video already has a recipe in the bank.");
      setDuplicateId(existingInBank);
      return;
    }
    setSubmitting(true);
    try {
      const pub = await publicBank.publish(recipeId, built.request);
      onPublished(pub);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof CloudApiError && err.code === "handle_taken") {
        setHandleError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't publish. Please try again.");
        if (err instanceof CloudApiError && err.code === "duplicate_video") setDuplicateId(err.existingPublicId);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-5">
        <DialogHeader>
          <DialogTitle>
            {intent === "fixSource" ? "Change the source" : existing ? "Public details" : "Publish this recipe"}
          </DialogTitle>
          <DialogDescription>
            {intent === "fixSource"
              ? "Check the link to where this recipe is from. Saving publishes it again and re-runs the automatic check."
              : existing
                ? "Change how this recipe is credited and shared. Saving also updates the public page to your latest version."
                : "Share it in the public recipe bank, with credit to where it came from."}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2.5">
          <h3 className={SECTION_LABEL}>Where's this recipe from?</h3>
          <Segmented<SourceKind>
            label="Where's this recipe from?"
            value={form.sourceKind}
            onChange={(sourceKind) => update({ sourceKind })}
            options={[
              { value: "video", label: "A video", icon: <Video className="h-4 w-4" /> },
              { value: "own", label: "My own recipe", icon: <User className="h-4 w-4" /> },
              { value: "other", label: "Somewhere else", icon: <Link2 className="h-4 w-4" /> },
            ]}
          />

          {form.sourceKind === "video" && (
            <div className="space-y-2.5">
              <div className="space-y-1">
                <label htmlFor="publish-video-url" className="text-sm text-[hsl(var(--ink))]">
                  Link to the video
                </label>
                <Input
                  id="publish-video-url"
                  autoFocus={intent === "fixSource"}
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://www.youtube.com/watch?v=…"
                  value={form.videoUrl}
                  onChange={(e) => update({ videoUrl: e.target.value })}
                />
                <p className="text-xs text-[hsl(var(--ink-faint))]">
                  YouTube and TikTok fill in the title, channel, and thumbnail for you.
                </p>
              </div>

              {preview.status === "loading" && (
                <p className="flex items-center gap-2 text-xs text-[hsl(var(--ink-muted))]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking up the video…
                </p>
              )}
              {preview.status === "error" && (
                <p role="alert" className="text-sm text-[hsl(var(--danger))]">
                  {preview.message}
                </p>
              )}
              {preview.status === "ready" && <SourcePreviewCard preview={preview.preview} />}
              {creditWarning && form.sourceKind === "video" && (
<CreditWarning text={creditWarning} />
              )}
              {existingInBank && (
                <div className="space-y-1 rounded-[10px] border border-[hsl(var(--caution-border))] bg-[hsl(var(--caution-tint))] px-3 py-2.5 text-sm text-[hsl(var(--caution-text))]">
                  <p className="font-medium">This video already has a recipe in the bank.</p>
                  <p>
                    <a href={publicHref(existingInBank)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      Open it
                    </a>{" "}
                    to save it instead — or share yours with <em>Anyone with the link</em> (one public page per video).
                  </p>
                </div>
              )}

              {detected?.platform === "other" && (
                <div className="space-y-1">
                  <label htmlFor="publish-video-credit" className="text-sm text-[hsl(var(--ink))]">
                    Creator's name
                  </label>
                  <Input
                    id="publish-video-credit"
                    placeholder="Who made the video"
                    maxLength={100}
                    value={form.videoCreditName}
                    onChange={(e) => update({ videoCreditName: e.target.value })}
                  />
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="publish-offset" className="text-sm text-[hsl(var(--ink))]">
                  My clip starts at{" "}
                  <Input
                    id="publish-offset"
                    inputMode="numeric"
                    aria-invalid={offsetInvalid}
                    className={cn(
                      "inline-flex h-8 w-[76px] px-2 text-center tabular-nums",
                      offsetInvalid && "border-[hsl(var(--danger))]",
                    )}
                    value={form.offsetText}
                    onChange={(e) => update({ offsetText: e.target.value })}
                  />{" "}
                  of the video
                </label>
                <p className={cn("text-xs", offsetInvalid ? "text-[hsl(var(--danger))]" : "text-[hsl(var(--ink-faint))]")}>
                  {offsetInvalid
                    ? "Write it as m:ss, e.g. 1:30."
                    : "If your recording starts part-way into the video, set where — so timestamps jump to the right moment."}
                </p>
              </div>
            </div>
          )}

          {form.sourceKind === "own" && (
            <p className="text-sm text-[hsl(var(--ink-muted))]">
              Shown as “Original recipe by @{normalizeHandle(form.handle) || existing?.handle || "you"}”.
            </p>
          )}

          {form.sourceKind === "other" && (
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="publish-other-url" className="text-sm text-[hsl(var(--ink))]">
                  Link
                </label>
                <Input
                  id="publish-other-url"
                  autoFocus={intent === "fixSource"}
                  inputMode="url"
                  placeholder="https://…"
                  value={form.otherUrl}
                  onChange={(e) => update({ otherUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="publish-other-name" className="text-sm text-[hsl(var(--ink))]">
                  Credit to
                </label>
                <Input
                  id="publish-other-name"
                  placeholder="Person, book, or site"
                  maxLength={100}
                  value={form.otherName}
                  onChange={(e) => update({ otherName: e.target.value })}
                />
              </div>
              {creditWarning && (
                <div className="sm:col-span-2">
                  <CreditWarning text={creditWarning} />
                </div>
              )}
            </div>
          )}
        </section>

        <section className="space-y-2.5">
          <h3 className={SECTION_LABEL}>Who can see it</h3>
          <div role="radiogroup" aria-label="Who can see it" className="grid gap-2 sm:grid-cols-2">
            <VisibilityOption
              checked={form.visibility === "public"}
              onSelect={() => update({ visibility: "public" })}
              title="Public"
              text="In the recipe bank and search."
              icon={<Globe className="h-4 w-4" />}
            />
            <VisibilityOption
              checked={form.visibility === "unlisted"}
              onSelect={() => update({ visibility: "unlisted" })}
              title="Anyone with the link"
              text="Not listed or searchable."
              icon={<Link2 className="h-4 w-4" />}
            />
          </div>
        </section>

        <section className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className={SECTION_LABEL}>Tags</h3>
            <span className="text-xs tabular-nums text-[hsl(var(--ink-faint))]">
              {form.tags.length} of {MAX_TAGS}
            </span>
          </div>
          {suggestedTags.length > 0 && (
            <div className="space-y-1.5 rounded-[10px] border border-dashed border-[hsl(var(--accent-tint-strong))] bg-[hsl(var(--accent-tint)/0.5)] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--accent-text))]">
                  <Sparkles className="h-3.5 w-3.5" /> Suggested
                </p>
                <button
                  type="button"
                  disabled={!canUseSuggested}
                  onClick={() => setTags(applySuggestedTags(form.tags, suggestedTags))}
                  className="rounded-full px-2 py-0.5 text-xs font-medium text-[hsl(var(--accent-text))] underline-offset-2 hover:underline disabled:no-underline disabled:opacity-50"
                >
                  {canUseSuggested ? "Use suggested" : "Added"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestedTags.map((tag) => {
                  const on = form.tags.includes(tag);
                  const full = !on && form.tags.length >= MAX_TAGS;
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={on}
                      disabled={full}
                      onClick={() => setTags(toggleTag(form.tags, tag))}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40",
                        on
                          ? "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint-strong))] text-[hsl(var(--accent-text))]"
                          : "border-dashed border-[hsl(var(--accent-fill))] bg-[hsl(var(--surface))] text-[hsl(var(--accent-text))] hover:bg-[hsl(var(--accent-tint))]",
                      )}
                    >
                      {on ? "" : "+ "}
                      {tagLabel(tag)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(Object.keys(TAGS) as Array<keyof typeof TAGS>).map((group) => (
            <div key={group} className="space-y-1.5">
              <p className="text-xs text-[hsl(var(--ink-muted))]">{TAG_GROUP_LABELS[group]}</p>
              <div className="flex flex-wrap gap-1.5">
                {TAGS[group].map((tag) => {
                  const on = form.tags.includes(tag);
                  const full = !on && form.tags.length >= MAX_TAGS;
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={on}
                      disabled={full}
                      onClick={() => setTags(toggleTag(form.tags, tag))}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40",
                        on
                          ? "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint-strong))] text-[hsl(var(--accent-text))]"
                          : "border-[hsl(var(--border-strong))] text-[hsl(var(--ink-muted))] hover:bg-[hsl(var(--accent-tint))]",
                      )}
                    >
                      {tagLabel(tag)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {form.needsHandle && (
          <section className="space-y-1.5">
            <h3 className={SECTION_LABEL}>Your handle</h3>
            <div className="flex items-center rounded-[var(--radius-control)] border border-[hsl(var(--input))] bg-[hsl(var(--card))] focus-within:ring-2 focus-within:ring-[hsl(var(--ring))]">
              <span className="pl-3 text-sm text-[hsl(var(--ink-faint))]">@</span>
              <input
                aria-label="Handle"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={21}
                placeholder="yourname"
                value={form.handle}
                onBlur={() => setHandleTouched(true)}
                onChange={(e) => {
                  setHandleError(null);
                  update({ handle: normalizeHandle(e.target.value) });
                }}
                className="h-10 w-full bg-transparent px-1 text-sm outline-none"
              />
            </div>
            <p className={cn("text-xs", handleError || handleHint ? "text-[hsl(var(--danger))]" : "text-[hsl(var(--ink-faint))]")}>
              {handleError ??
                handleHint ??
                `Shown as “Transcribed by @${normalizeHandle(form.handle) || "yourname"}”. You can't change it later.`}
            </p>
          </section>
        )}

        <div className="space-y-1.5 rounded-[10px] bg-[hsl(var(--sunken))] px-4 py-3 text-sm">
          <p className="font-medium text-[hsl(var(--ink))]">What goes public</p>
          <p className="text-[hsl(var(--ink-muted))]">
            The recipe as it is now and its “double-check” notes, the credit above, your handle, and the tags.{" "}
            <strong className="font-medium text-[hsl(var(--ink))]">Never</strong> your transcript, audio, or version
            history. Later edits stay private until you choose <em>Update public version</em>.
          </p>
          <p className="text-xs text-[hsl(var(--ink-faint))]">
            By publishing you agree to the{" "}
            <a href={termsHref()} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Terms of use
            </a>
            . New recipes get a quick automatic check first.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[hsl(var(--danger))]">
            {error}
            {duplicateId && (
              <>
                {" "}
                <a href={publicHref(duplicateId)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  Open it
                </a>
              </>
            )}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || duplicateBlocked || offsetInvalid}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            {submitting ? "Publishing…" : existing ? "Save and update" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
