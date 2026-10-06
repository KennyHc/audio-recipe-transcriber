# Design direction

A calm, bright, cookbook-like tool. Cool and airy, not warm/beige. The recipe is the hero;
chrome recedes. Think a well-set modern cookbook page, not a dashboard.

## Palette (define as CSS variables in index.css, HSL, light + dark)

Light (default look — people cook in bright kitchens):
- background `#F6F9FC` (faint cool tint), surface/card `#FFFFFF`, sunken `#EEF3F8`
- ink `#0F1B2D`, ink-muted `#5B6B80`, ink-faint `#8A98AB`
- border `#E2E8F0`, border-strong `#CBD5E1`
- accent (light blue): `#3B9EEB` for fills/indicators; `#1F7FCB` for text/links;
  tint `#E8F3FD`; tint-strong `#CFE6FA`
- caution (vague / warnings) — USER DECISION: light blue, no yellow/amber anywhere.
  Callout + highlighted rows: tint `#EAF4FD`, border `#BFDDF7`, text `#17609C`, icon `#3B9EEB`.
  "vague" pill: bg `#D6EAFB`, text `#0F4F85` (must stay readable — ≥4.5:1).
- inferred: ink-muted text on sunken bg with a dashed border
- danger: `#D14343`
- **primary button** (its own, deeper tokens — see Buttons below): `--primary-from #1C78C4`
  → `--primary-to #1A5FA8`, ink `#FFFFFF`.

Dark:
- background `#0B1220`, surface `#111A2B`, sunken `#0E1626`
- ink `#E6EDF6`, ink-muted `#93A3B8`, border `#1F2B3E`
- accent `#6CB8F0` (fills and text), tint `#12263D`
- caution: tint `#10243A`, border `#1E4468`, text `#9CCBF3`, icon `#6CB8F0`;
  "vague" pill: bg `#1A3A5C`, text `#CFE6FA`
- **primary button**: `--primary-from #6CB8F0` → `--primary-to #4FA3E6`, ink `#0B1220` (dark
  text on the light fill — white-on-light-blue fails contrast here).

No orange, brown, beige or cream anywhere. Gradients are used sparingly and only in two
places: the primary button fill (see Buttons), and a very faint accent wash behind the
library hero / recipe header (a soft top-to-bottom tint plus a subtle radial glow, never
a loud or saturated gradient).

## Buttons

The primary button is its own token set (`--primary-from`, `--primary-to`, `--primary-ink`,
plus `--shadow-primary` / `--shadow-primary-hover`), defined in `index.css` for both themes
and consumed only by `components/ui/button.tsx`'s `default` variant so every primary button
in the app (Cook, Next/Previous, Start timer, Download, Save, Edit-mode Save…) stays in sync.

- Fill: a subtle 180° vertical gradient, `--primary-from` at the top to `--primary-to` at
  the bottom — deep, saturated blues in light mode so white text clears 4.5:1 contrast at
  every point in the gradient (not just on average); a light fill with **dark** ink in dark
  mode, for the same reason.
- Depth: a 1px inset top highlight + a soft shadow (`--shadow-primary`). In light mode this
  carries a touch of the fill color; in dark mode it's neutral/uncolored — a saturated
  colored glow there read as a blurry halo around the button, so dark mode keeps only a
  plain, subtle drop shadow like the rest of the UI's floating elements.
- Interaction: hover nudges brightness up slightly and deepens the shadow
  (`--shadow-primary-hover`); active dims slightly and swaps to an inset shadow so the
  button reads as pressed. No layout shift on either state.
- Every other variant (secondary, outline, ghost, destructive, link) is unchanged — flat
  fills/borders, no gradient.

## Type

- UI: **Geist Variable** (`@fontsource-variable/geist`), 15–16px base, `font-feature-settings: "tnum"`
  for quantities/timestamps.
- Display: **Instrument Serif** (`@fontsource/instrument-serif`) for the recipe title,
  the library heading, and the big step numerals only. Title ~44–56px desktop, ~34px mobile,
  tight leading (1.05), slight negative tracking.
- Section labels ("Ingredients", "Method", "Notes"): 12px uppercase, 0.08em tracking, ink-muted.

## Shape & depth

- Radius: 10px cards, 8px controls (inputs, textareas, selects, buttons all share
  `--radius-control`), full pills for chips.
- Borders over shadows. One soft shadow for floating things only (audio bar, menus, dialogs,
  select/dropdown panels): `--shadow-float` = `0 1px 2px rgb(15 27 45 / .04), 0 12px 32px
  -12px rgb(15 27 45 / .18)`.
- Generous whitespace; max content width ~1120px.
- Text wrapping: `text-wrap: balance` on all headings (h1–h3) and `text-wrap: pretty` on
  paragraphs/list items by default (set globally in `index.css`'s `@layer base`), so a
  heading doesn't leave one word alone on its own line and body copy doesn't end on a very
  short last line. Any element can opt out with Tailwind's `text-nowrap`/`text-wrap` utilities
  (the dropzone's format line explicitly uses `text-balance` instead of the paragraph
  default, since it reads better as a balanced two-line caption than a "pretty" one).
- Dates: friendly absolute format via `Intl.DateTimeFormat` (`lib/format.ts`'s
  `formatFriendlyDate`) — "Today" / "Yesterday" for the last two days, otherwise e.g.
  "Sep 26, 2026". Used in library cards and the version history dialog; not a relative
  "2 hours ago" style, which read as noisier than it needed to be.

## Layout

**Top bar**: slim, sticky (`position: sticky; top: 0`) with a translucent surface
(`hsl(var(--surface) / 0.75)`) and `backdrop-blur-md` so content scrolling underneath
softens rather than hard-cuts, bottom border. Left: logo mark (lucide `AudioLines` in a
28px rounded-square accent tint) + wordmark "Recipe Transcriber" in Geist semibold. Right:
theme toggle (light / dark / system).

**Library (`#/`)**:
- Hero: ONE band (no outer bordered card) with a quiet gradient backdrop — a top-to-bottom
  accent-tint → background wash plus two very-low-opacity, large, blended radial glows
  (never a single tight one, which reads as a visible smudge/blob edge, especially on
  mobile dark). Two-column layout ≥1024px: left = serif heading "Turn cooking audio into
  recipes" + one muted subline; right = the dropzone as a compact card (~120–140px tall).
  Below 1024px the dropzone sits under the text at that same compact height, so it no
  longer fills the whole first mobile screen on its own. Below both, a quiet "how it works"
  row with 3 items. ≥640px: icon + one ink-muted line each ("Drop a clip" / "Transcribed on
  your device" — or "Transcribed on this machine" when `backend.kind === "server"`
  (local-server mode) — / "A recipe you can check against the audio"). <640px: a tighter
  3-column row — small icon above a 2–3 word label ("Drop a clip" / "Transcribed locally" /
  "Check vs audio") — plus tighter hero padding overall, so on a 390px phone the first
  recipe card's title is visible without scrolling.
- Upload zone: compact (~120–140px tall everywhere, not a giant box) — a soft accent-tint
  circle holding the upload icon, headline "Drop a cooking clip here", a secondary
  ink-faint line with the formats and size limit ("MP3, M4A, WAV and more · up to 200 MB",
  matching the real 200 MB upload cap in both backends) set with `text-balance` so it never
  leaves an orphaned last word. Dashed border-strong, accent border + tint on hover/drag.
- Recipes: responsive card grid (1 / 2 / 3 cols). Card = a small accent-tinted rounded
  square holding the noodle-bowl mark (replaces the generic file icon), serif title (or
  file name muted if no title), date + status (small colored dot + label; "Ready" doesn't
  need a badge), hover lift (soft shadow + border-strong, slight upward translate). Delete
  lives in a card "⋯" menu, not an exposed button. (The jobs list API only returns a
  recipe `title`, no description — no excerpt is shown.)
- Empty state: dashed card with a short friendly two-line message, no illustration needed.

**Recipe page (`#/jobs/:id`)**:
- Header: same gradient-band treatment as the library hero but quieter still (lower
  opacity tint, smaller/softer blended glow — same "two low-opacity radials, never one
  tight blob" rule), rounded, bordered. Inside it: back link is above the band; title
  (serif), description (ink-muted, max 65ch), then a quiet stats line beneath it — e.g.
  "8 ingredients · 7 steps · 7:36 audio" (ink-faint, tabular-nums; ingredient/step counts
  come straight off the recipe, audio duration off the existing hidden `<audio>` element's
  metadata — the audio clause is simply omitted if the duration isn't known yet, no extra
  request). Actions top-right (Cook/Edit + "⋯" dropdown), then one tidy control row
  grouping the servings stepper with the Original/Metric/Imperial segmented control, and
  the total-time pill alongside — all quiet pill controls, wraps on mobile.
- Actions: a primary "Cook" button + secondary "Edit" + a "⋯" dropdown (History,
  Re-extract, Copy as Markdown, Print). Top-right of the header. Recipe/Transcript tabs are
  a simple underline tab bar, not a boxed segmented control — and they're attached to the
  *bottom edge* of the header card itself (full-bleed divider, flush with the card's
  bottom border, horizontally aligned with the rest of the header's content) rather than
  floating as an orphaned element between the header and the warnings bar. The tab panels
  (recipe content, starting with the warnings bar; transcript) sit below the card.
- Warnings: compact callout "3 things to double-check" (caution tint), collapsed by
  default to its summary line with a chevron; expanded shows the list. Inline highlights on
  targeted rows stay, but subtle: caution-tint background + small caution dot, not a
  heavy box.
- Body ≥1024px: two columns. Left (~340px) ingredients card, `position: sticky`
  under the top bar. Right: Method. Below 1024px: stacked.
- Ingredients: checklist rows; checkbox custom-styled (accent when checked, row text
  struck through + ink-faint). Quantity+unit in medium weight tabular; item regular; prep in
  ink-muted. The timestamp ghost chip sits right-aligned on the *same line* as the
  ingredient text (not its own line below) — ink-faint, becomes accent on row hover.
  Confidence ("vague" / "inferred") and verifier warnings show as a tiny pill on the line
  below, only when present. Flagged rows get a light caution tint plus a 2px left accent
  bar, not a full-width heavy block.
- Method: ~24px between steps (hairline divider stays), numeral in a 32px accent-tint-strong
  circle set in the **sans** font, semibold, 14px, tabular-nums, accent-text color (the
  serif numeral reads thin/faint at this size — reserve serif numerals for cook mode's much
  larger ones). Step text 15–17px/1.6. Duration/temperature chips, the ▶ timestamp, and the
  warning pill all sit on one wrapping row under the text. The step currently playing:
  accent tint background + accent left border.
- Notes/Tips: after Method, in a soft tinted panel (`accent-tint` at ~50% opacity, 10px
  radius, comfortable padding) — heading with the lightbulb icon, ink-muted list, timestamps
  right-aligned as elsewhere.

**Audio bar**: floating pill centered at the bottom (max ~720px, 12px from the bottom
edge), surface + shadow. Custom controls (not native `<audio controls>`): play/pause
button (accent), −10s/+10s, current time / duration (tabular), a slim scrubber (accent
fill on border track), and the currently playing step's short text truncated on the right
(hidden on mobile). Keep the `<audio>` element hidden and drive it.

**Processing view**: a clean vertical or horizontal progress with 4 steps, the active one
with a subtle pulsing accent dot, the file name above, and a line "This usually takes 1–3
minutes" in ink-muted.

**Error view**: danger-tinted callout with the message; the setup-command chip stays.

**Dialogs/menus**: surface, 10px radius, soft shadow, backdrop `rgb(15 27 45 / .35)` with slight blur.

## Motion

150–200ms ease-out for hover/press/expand; no bouncy animations. Respect `prefers-reduced-motion`.

## Don'ts

No emojis in UI. No orange. No all-caps buttons. No heavy drop shadows on cards.
Don't show every action as a visible button.

## Cook mode

A full-screen, one-step-at-a-time view for following along at the stove. Readable from
an arm's length away with messy hands.

- **Entry**: a "Cook" button (lucide `ChefHat` or `Play`) next to Edit in the recipe
  header — primary styling; Edit becomes secondary. Opens as a full-screen overlay inside
  the job page (so it shares the scale factor, unit system, and the audio element).
  Esc, the ✕ button, and the browser back button all exit.
- **Keep screen awake**: request the Screen Wake Lock (`navigator.wakeLock.request("screen")`)
  on open, release on exit, re-acquire on `visibilitychange`. Show a tiny ink-faint
  "Screen stays on" indicator; if unsupported, say nothing.
- **Slides**: slide 0 "Gather your ingredients" (the checklist, sharing checked state with
  the recipe page), then one slide per step, then a short "Enjoy your meal" end slide.
- **Step slide**: "Step 3 of 7" + thin accent progress bar at top; big serif numeral;
  step text at 28–34px desktop / 22–24px phone, max ~32ch, generous line height.
  Above the text: chips for the ingredients this step uses (matched from the step text,
  with scaled/converted quantities); the checkmark slot only takes up space once a chip is
  actually checked, so unchecked chips have no reserved blank padding on the left. Below:
  duration/temperature chips, the status pill if the step has a warning, and "Hear this
  step" (plays the audio from this step's timestamp until the next step's). Buttons here
  (Start timer, Next/Previous, Hear this step) use the same primary/outline button styles
  as the rest of the app.
- **Timers**: if a step has `durationMinutes`, a large "Start 9 min timer" button. Timers
  keep running when you move between steps; running timers show in a slim tray (label =
  short step text, mm:ss, pause/cancel). On finish: a gentle chime (Web Audio, no files),
  the timer pulses accent, and it stays until dismissed. Several timers can run at once.
- **Navigation**: large Previous / Next buttons at the bottom (thumb reach on phones),
  ←/→ and Space keys, and horizontal swipe on touch. No accidental exits on swipe.
- **Look**: background/surface tokens, lots of whitespace, no chrome besides the top
  progress row and bottom nav. Motion: short cross-fade between slides; none with
  `prefers-reduced-motion`.
