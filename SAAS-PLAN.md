# SaaS plan: Recipe Transcriber on Google Cloud

Status: **plan only — nothing built yet.** Written 2026-10-08.

## 1. What changes

Today the hosted app is anonymous: recipes live only in the visitor's browser (IndexedDB) and
a Cloudflare Worker proxies Claude with a per-visitor daily limit.

The SaaS version adds:

- **Accounts** — sign in to keep recipes across devices.
- **Private library** — every recipe belongs to its creator; private by default.
- **Publishing** — a creator can make a recipe public (or unlisted: anyone with the link).
- **Public recipe bank** — browse, search, and cook public recipes; save them to your own
  cookbook. Two audiences: **creators** (turn clips into recipes) and **cooks** (consume them).
- **Plans and billing** — a free tier plus a paid tier for heavy creators.

What stays the same: **transcription keeps running on the user's device** (Whisper in the
browser). That keeps audio private and is the single biggest cost saving — it means our
per-recipe cost is only the Claude call (~1.5¢), not GPU time.

## 2. Architecture (Firebase = Google Cloud)

```
Browser (React app, Whisper on device)
  │  Firebase Auth (Google / Apple / email link)  ──► ID token
  │
  ├─► Firestore  (direct reads/writes, enforced by Security Rules)
  │     users, recipes, versions, saves, likes, reports
  │
  └─► Cloud Run "api" (Node; reuses shared/ prompts + finalizeWarnings)
        POST /extract, /verify   ── verifies ID token + App Check
        • per-user monthly quota + global daily budget (Firestore transactions)
        • Anthropic key from Secret Manager ──► Claude (Haiku 4.5)
        • writes the new recipe version server-side (users can't fake "extracted" output)

Firebase Hosting ── static site (CDN)        Hugging Face ── Whisper model files (unchanged)
Stripe ── checkout + webhook → Cloud Run → users/{uid}.plan
```

| Need | GCP service | Why |
|---|---|---|
| Auth | **Firebase Authentication** (Identity Platform) | Google/Apple/email-link sign-in in a day; free to 50k MAU |
| Database | **Firestore** (native mode) | Per-user + public documents, Security Rules, real-time, generous free tier, no server to run |
| API | **Cloud Run** | Scales to zero; the existing Worker/server logic ports almost as-is |
| Static site | **Firebase Hosting** | CDN + custom domain + HTTPS; not a `*.workers.dev` host (Hugging Face blocks those) |
| Secrets | **Secret Manager** | Anthropic key, Stripe keys |
| Abuse | **App Check** (reCAPTCHA Enterprise) | Replaces Turnstile; only our app can call the API |
| Payments | **Stripe** (not GCP) | Checkout, customer portal, webhooks |
| Ops | Cloud Logging, Error Reporting, **Billing budget alerts** | See failures without users pasting console logs |

**Region — DECIDED: EU.** Firestore in the `eur3` multi-region (Belgium + Netherlands; high availability), Cloud Run and Secret Manager in `europe-west1` (Belgium), Firebase Hosting serves globally from its CDN. Firestore's location can't be changed after creation, so this is set once. Note: Anthropic processes the transcript text under its own terms — list it as a processor in the privacy page.

**Why not Cloud SQL (Postgres)?** Better full-text search and joins, but it's ~$10–30/month
from day one and needs an API layer for every read. Firestore is ~$0 at launch. Revisit if the
public bank needs serious search (then add Postgres or a search service *alongside* Firestore).

## 3. Data model (Firestore)

```
users/{uid}
  displayName, photoURL, handle (unique, for public profile)
  plan: "free" | "pro", stripeCustomerId
  usage: { month: "2026-10", recipesCreated: 3 }      // written only by the API

recipes/{recipeId}
  ownerId, visibility: "private" | "unlisted" | "public"
  title, description, servings, totalTimeMinutes, ingredients[], steps[], tips[], warnings[]
  currentVersion, createdAt, updatedAt, publishedAt
  source: { kind: "video" | "class" | "own", url?, videoId?, title?, channelName?,
            channelUrl?, thumbnailUrl? }  // credit; required for public video recipes
  search: { titleWords[], ingredientWords[], tags[] }                // for queries
  stats: { saves, likes, cooks }                                     // counters (server-updated)
  forkedFrom?: recipeId

recipes/{id}/versions/{n}       full Recipe snapshot + source ("extracted" | "edited" | ...)
recipes/{id}/private/transcript owner-only, NEVER public (it's the raw speech)
users/{uid}/saves/{recipeId}    a cook's saved public recipes
users/{uid}/likes/{recipeId}
reports/{id}                    { recipeId, reporterId, reason } → moderation queue
```

**Security Rules (summary):**
- `private` recipes: read/write only by `ownerId`.
- `public`/`unlisted`: anyone can read the recipe and its latest version; only the owner edits.
- Transcripts: owner only, always.
- `usage`, `plan`, `stats`: never client-writable (API/webhooks only).
- New extracted versions come only from the API, so quotas can't be bypassed.

**Audio:** stays on the device by default. Click-to-hear works for the creator. Public
recipes link to the **original video/source** instead of rehosting audio (see §6).

## 4. Product scope by phase

| Phase | Scope | Size |
|---|---|---|
| **1. Accounts + cloud library** | Sign-in; recipes saved to Firestore per user (private); API on Cloud Run with per-user quota; import existing browser library (the backup file already exists); account deletion + data export | ~1–1.5 weeks |
| **2. Publishing + public bank** | Visibility toggle with attribution/source URL; public recipe pages (shareable URLs, server-rendered meta for link previews); browse (newest, popular), search by title/ingredient/tag; save/fork to my cookbook; likes; cook mode without an account; report button; simple admin moderation view | ~1.5–2 weeks |
| **3. Billing** *(deferred — free with limits for now)* | Stripe checkout + portal; free vs Pro limits | ~3–5 days |
| **4. Growth** | Creator profiles (`/@handle`), collections, better search (Postgres/Typesense), email digests, PWA/offline cook mode, server-side transcription for weak phones | later |

Keep the **local-server** and **bring-your-own-key** modes as the open-source/self-host
option; the hosted SaaS becomes a fourth backend (`cloud`) behind the same `Backend` interface.

## 5. Costs

### Unit costs (measured or list price)

| Item | Cost |
|---|---|
| Claude per recipe (Haiku 4.5 extract + verify) | **~$0.015** (measured: 1.1–1.5¢ over 9 eval runs) |
| …with Sonnet 5 extracting | ~$0.03 |
| Transcription | **$0** to us (runs on the user's device) |
| Firestore | free: 50k reads + 20k writes/day, 1 GiB; then ≈ $0.03–0.06 per 100k reads, ≈ $0.09–0.18 per 100k writes (region-dependent) |
| Cloud Run | free: 2M requests, 180k vCPU-s, 360k GiB-s per month; then ≈ $0.000024/vCPU-s |
| Firebase Auth | free to 50k MAU; ≈ $0.0055/MAU above (Identity Platform tier) |
| Firebase Hosting | 10 GB storage, ~10 GB/month transfer free; then ≈ $0.15/GB |
| Stripe | 1.5–2.9% + fee per payment (varies by card/region) |
| Domain | ~$12/year |

*GCP prices are list prices from memory and vary by region — confirm in the Google Cloud
pricing calculator before launch. Claude prices are from this repo's measured eval runs.*

### Monthly estimates

Assumptions: each created recipe = 2 Claude calls; a browsing session reads ~20 recipe cards;
each recipe view reads ~3 documents.

| | **Launch** | **Growing** | **Scale** |
|---|---|---|---|
| Monthly active users | 500 | 10,000 | 100,000 |
| Recipes created / month | 1,000 | 20,000 | 200,000 |
| Recipe views / month | 20k | 500k | 5M |
| Claude | $15 | $300 | $3,000 |
| Firestore | $0 (free tier) | ~$5–10 | ~$60–120 |
| Cloud Run | $0 (free tier) | ~$5–15 | ~$80–150 |
| Hosting / CDN | $0 | ~$2–5 | ~$30–60 |
| Auth | $0 | $0 | ~$0–275* |
| Logging, secrets, misc | ~$1 | ~$5 | ~$30 |
| **Total** | **~$15–20** | **~$320–340** | **~$3.2–3.6k** |

\* $0 on plain Firebase Auth for Google/email sign-in; up to ~$275 if billed on Identity Platform MAU pricing above 50k.

**Claude is ~90% of the bill at every size**, so costs track recipes *created*, not users.
Cooks who only browse public recipes cost almost nothing — which suits the creator/consumer split.

### Making it pay

| Plan | Limit | Max Claude cost to us | Price idea |
|---|---|---|---|
| Free | 5 recipes / month | $0.075 / user / month | $0 |
| Pro | 100 recipes / month | $1.50 / user / month | $4–5 / month |

At 10k MAU, a 3% Pro conversion (300 × $4.50 ≈ $1,350/month) covers the ~$330 bill several
times over. Free browsing of the public bank stays free and is the growth engine.

### Guard rails (non-negotiable before launch)
- Anthropic Console monthly spend limit (already set) + **GCP billing budget alerts** at 50/90/100%.
- Global daily Claude budget in the API (as today), per-user monthly quota, App Check.
- Max transcript size (as today).

## 6. Risks and decisions

1. **Copyright / creator rights — DECIDED: allow recipes from YouTube and other videos, with
   proper credit.** Ingredient lists are generally not copyrightable, but a creator's wording,
   story, and video are, so publishing works like this:
   - **Source link required.** A public recipe from a video must include the video URL. The app
     fetches the title, channel name, and thumbnail via YouTube's public oEmbed endpoint (no API
     key) so credit is accurate and can't be typed wrong.
   - **Credit is prominent and automatic.** Top of the recipe page: "Recipe by **{Channel}** ·
     Watch the original video", with the official embedded YouTube player (where the creator
     allows embedding). The poster is shown as "Transcribed by @handle", never as the author.
   - **Timestamps link to the video.** On public recipes, each ingredient/step timestamp seeks
     the embedded video (or opens `youtu.be/{id}?t=…`) — this replaces click-to-hear for cooks
     and sends views back to the creator.
   - **We never rehost their audio or video**, only the structured recipe in our own wording
     (the extractor paraphrases; transcripts are never public).
   - **Creator claim + takedown.** A "Is this your video?" link on every credited recipe: a
     creator can request removal or claim the page (verified later via YouTube channel
     sign-in). Takedowns handled within a few days; Terms make the poster responsible and
     include a DMCA/notice address.
   - **One canonical page per video.** If a video was already published, offer to open/save
     the existing public recipe instead of creating duplicates.
2. **Moderation.** Public titles/descriptions are user text. Report button + admin queue at
   launch; optional cheap Haiku screening on publish.
3. **GDPR** (EU users): account deletion and export, EU region, updated privacy page, DPA
   with Anthropic/Google/Stripe.
4. **Hugging Face dependency** for model files remains (noted in LAUNCH-NOTES.md). Firebase
   Hosting isn't on `*.workers.dev`, so the earlier block doesn't apply.
5. **Phones:** the 762 MB model is heavy; default phones to the small model, and consider
   server-side transcription as a paid feature later (Cloud Run GPU, roughly the same order of
   cost per clip as the Claude call — benchmark before committing).

## 7. Decisions

| Decision | Choice |
|---|---|
| Public bank policy | Videos allowed, with required source link + automatic credit (§6.1) |
| Region | EU — Firestore `eur3`, Cloud Run / Secret Manager `europe-west1` |
| Sign-in | Google + email link (no Apple for now) |
| Pricing | **Free with a usage limit**; paid plans later (Phase 3 deferred) |
| Domain | Keep `recipe-transcriber.pages.dev` for now; branding later |

Because the domain stays on Cloudflare Pages for now, the **static site stays on Cloudflare
Pages** and only the backend moves to Google Cloud (Firebase Auth, Firestore, Cloud Run).
Moving the site to Firebase Hosting is a later, independent step tied to the branding/domain.

Phase 1 build plan: see **PHASE1-PLAN.md**.
