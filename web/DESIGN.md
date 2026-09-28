# Design direction

A calm, bright, cookbook-like tool. Cool and airy, not warm/beige. The recipe is the hero;
chrome recedes. Think a well-set modern cookbook page, not a dashboard.

## Palette (define as CSS variables in index.css, HSL, light + dark)

Light (default look — people cook in bright kitchens):
- background `#F6F9FC` (faint cool tint), surface/card `#FFFFFF`, sunken `#EEF3F8`
- ink `#0F1B2D`, ink-muted `#5B6B80`, ink-faint `#8A98AB`
- border `#E2E8F0`, border-strong `#CBD5E1`
- accent (light blue): `#3B9EEB` for fills/indicators; `#1F7FCB` for text/links and
  primary button (AA contrast on white); tint `#E8F3FD`; tint-strong `#CFE6FA`
- caution (vague / warnings) — USER DECISION: light blue, no yellow/amber anywhere.
  Callout + highlighted rows: tint `#EAF4FD`, border `#BFDDF7`, text `#17609C`, icon `#3B9EEB`.
  "vague" pill: bg `#D6EAFB`, text `#0F4F85` (must stay readable — ≥4.5:1).
- inferred: ink-muted text on sunken bg with a dashed border
- danger: `#D14343`

Dark:
- background `#0B1220`, surface `#111A2B`, sunken `#0E1626`
- ink `#E6EDF6`, ink-muted `#93A3B8`, border `#1F2B3E`
- accent `#6CB8F0` (fills and text), tint `#12263D`
- caution: tint `#10243A`, border `#1E4468`, text `#9CCBF3`, icon `#6CB8F0`;
  "vague" pill: bg `#1A3A5C`, text `#CFE6FA`

No orange, brown, beige or cream anywhere. No gradients except, at most, a very faint
accent wash behind the library hero.

## Type

- UI: **Geist Variable** (`@fontsource-variable/geist`), 15–16px base, `font-feature-settings: "tnum"`
  for quantities/timestamps.
- Display: **Instrument Serif** (`@fontsource/instrument-serif`) for the recipe title,
  the library heading, and the big step numerals only. Title ~44–56px desktop, ~34px mobile,
  tight leading (1.05), slight negative tracking.
- Section labels ("Ingredients", "Method", "Notes"): 12px uppercase, 0.08em tracking, ink-muted.

## Shape & depth

- Radius: 10px cards, 8px controls, full pills for chips.
- Borders over shadows. One soft shadow for floating things only (audio bar, menus, dialogs):
  `0 1px 2px rgb(15 27 45 / .04), 0 12px 32px -12px rgb(15 27 45 / .18)`.
- Generous whitespace; max content width ~1120px.

## Layout

**Top bar**: slim, white/surface, bottom border. Left: logo mark (lucide `AudioLines` in a
28px rounded-square accent tint) + wordmark "Recipe Transcriber" in Geist semibold. Right:
theme toggle (light / dark / system).

**Library (`#/`)**:
- Hero: serif heading "Turn cooking audio into recipes", one muted line under it.
- Upload zone: compact (not a giant box), dashed border-strong, accent on hover/drag,
  icon + "Drop an audio file or browse" + formats in ink-faint.
- Recipes: responsive card grid (1 / 2 / 3 cols). Card = serif title (or file name muted if
  no title), date + status (small colored dot + label; "Ready" doesn't need a badge),
  hover lift via border-strong. Delete lives in a card "⋯" menu, not an exposed button.
- Empty state: short friendly line, no illustration needed.

**Recipe page (`#/jobs/:id`)**:
- Header: back link (ink-muted), then title (serif), description (ink-muted, max 65ch),
  then a meta row: servings stepper, total time, and the Original/Metric/Imperial segmented
  control — all as quiet pill controls on one line (wraps on mobile).
- Actions: one primary-ish "Edit" button + a "⋯" dropdown (History, Re-extract,
  Copy as Markdown, Print). Top-right of the header. Recipe/Transcript tabs as a simple
  underline tab bar, not a boxed segmented control.
- Warnings: compact callout "3 things to double-check" (caution tint), collapsed by
  default to its summary line with a chevron; expanded shows the list. Inline highlights on
  targeted rows stay, but subtle: caution-tint background + small caution dot, not a
  heavy box.
- Body ≥1024px: two columns. Left (~340px) ingredients card, `position: sticky`
  under the top bar. Right: Method. Below 1024px: stacked.
- Ingredients: checklist rows; checkbox custom-styled (accent when checked, row text
  struck through + ink-faint). Quantity+unit in medium weight tabular; item regular;
  prep in ink-muted. Confidence: "vague" / "inferred" as tiny pills. Timestamp: small ghost
  "0:22" chip that is ink-faint and becomes accent on row hover.
- Method: numbered steps with serif numerals in accent (~28px) in a left gutter, step text
  17px/1.6. Duration/temperature as small sunken chips under the text. The step currently
  playing: accent tint background + accent left border.
- Notes/Tips: after Method, a quiet list with a small lightbulb icon, ink-muted.

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
  with scaled/converted quantities). Below: duration/temperature chips, the status pill
  if the step has a warning, and "Hear this step" (plays the audio from this step's
  timestamp until the next step's).
- **Timers**: if a step has `durationMinutes`, a large "Start 9 min timer" button. Timers
  keep running when you move between steps; running timers show in a slim tray (label =
  short step text, mm:ss, pause/cancel). On finish: a gentle chime (Web Audio, no files),
  the timer pulses accent, and it stays until dismissed. Several timers can run at once.
- **Navigation**: large Previous / Next buttons at the bottom (thumb reach on phones),
  ←/→ and Space keys, and horizontal swipe on touch. No accidental exits on swipe.
- **Look**: background/surface tokens, lots of whitespace, no chrome besides the top
  progress row and bottom nav. Motion: short cross-fade between slides; none with
  `prefers-reduced-motion`.
