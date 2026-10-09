# Phase 2 build plan: publishing + the public recipe bank

Goal: creators publish recipes with proper credit to the original video; cooks browse, search,
save, and cook public recipes — with or without an account. Builds on Phase 1 (live since
2026-10-09). Context and the credit policy: SAAS-PLAN.md §6.1.

## What people see

**Creators (signed in)**
1. On their own recipe: **Publish…** opens a dialog:
   - **Where's this recipe from?** — *A video* (paste the link; YouTube and TikTok fill in the
     title, channel, and thumbnail automatically; other sites: type the creator's name) ·
     *My own recipe* · *Somewhere else* (link + name).
   - **Who can see it** — *Public* (in the bank and search) or *Anyone with the link* (unlisted).
   - **Tags** — cuisine, meal, diet (fixed lists; we suggest some).
   - **Video timing** — "My clip starts at 0:00 of the video" (adjustable), so timestamps
     jump to the right moment in the original.
   - First publish only: pick a **handle** (`@kenny`), shown as "Transcribed by @kenny".
   - Shows exactly what goes public: the recipe and its warnings. **Never** the transcript,
     audio, or version history.
2. If the same video is already in the bank: "This video already has a recipe — open it /
   save it instead?" (one page per video; publishing a duplicate is blocked for public,
   allowed for unlisted).
3. A published recipe shows a **Public** badge and a link to its public page. Editing the
   private recipe doesn't change the public page until **Update public version** (so a
   half-finished edit never goes live). **Unpublish** removes it from the bank immediately.

**Cooks (anyone)**
4. **Explore** (new top-level page, works signed out): Newest · Popular · search box
   (title or ingredient) · tag chips.
5. **Public recipe page** `recipe-transcriber.pages.dev/r/{id}`:
   - Top: "Recipe by **{Channel}** · Watch the original video" with the embedded player
     (youtube-nocookie.com; TikTok embed or link), then "Transcribed by @handle".
   - The recipe as today (servings, units, step scaling, warnings, cook mode). Timestamps
     **seek the embedded video** (replacing click-to-hear).
   - **Like** (a heart with a count), **Save** (signed-in; adds to "Saved" in their library,
     follows later updates), and **Make a copy** (a private, editable copy in their own library; no AI call, free).
   - **Report** and, on video recipes, **Is this your video?** (claim / takedown request).
   - Link previews (WhatsApp, iMessage, Slack) show the title, photo, and channel.

**Moderation (you, as admin)**
6. Every publish is screened by a cheap Haiku call (spam, abuse, non-recipes); flagged items
   go to review instead of the bank.
7. **Admin** page (only for admin accounts): open reports and claims, flagged publishes;
   actions *Hide*, *Restore*, *Dismiss*. You get an email when something new arrives.

## Key design choices

| Choice | Why |
|---|---|
| **A separate `publicRecipes/{id}` snapshot**, written only by the API | Public rules stay trivial (anyone reads), the private recipe/history/transcript never mix with public data, and "Update public version" is just a re-snapshot. |
| **Publishing goes through the API** (`POST /recipes/:id/publish`) | Credit must be verified server-side (oEmbed), duplicates checked, screening run, handle reserved — none of which the browser can be trusted with. |
| **Likes and saves, both API-written** | Likes are quick appreciation; saves are "I'll cook this". *Popular* ranks by `likes + 2 × saves` (a stored `stats.score`, so it's one indexed query). Counts change only through the API, so they can't be inflated from the browser. |
| **Path URLs for public pages (`/r/{id}`)** with a Cloudflare Pages Function adding meta tags | Link-preview crawlers ignore `#/` routes; the function reads the public doc (Firestore REST) and injects title/image/description into index.html. Private pages keep hash routes. |
| **Search via a `terms` array** (lowercased words from title + ingredients + tags) | Firestore-native `array-contains`, no extra service; good to ~thousands of recipes. Swap in Typesense/Postgres in Phase 4 if needed. |
| **Video start offset** stored per public recipe | Uploaded clips often start mid-video; without it every timestamp would seek to the wrong moment. |

## Data model additions

```
publicRecipes/{id}      (id = the private recipe id)
  ownerId, handle, visibility: "public" | "unlisted"
  status: "live" | "review" | "hidden"          (API/admin only)
  recipe: Recipe                                  (snapshot; never the transcript)
  source: { kind: "video" | "own" | "other",
            platform?: "youtube" | "tiktok" | "other", videoId?, url?,
            title?, channelName?, channelUrl?, thumbnailUrl?, startOffsetSeconds }
  tags[], terms[]                                 (search)
  stats: { saves, likes, score }                  (API only; score = likes + 2×saves)
  publishedAt, updatedAt
handles/{handle}        { uid }                   (uniqueness; API only)
users/{uid}             + handle, + roles.admin (set by you via a script)
sources/{platform:videoId}  { publicRecipeId }    (one page per video; API only)
users/{uid}/saves/{publicId}  { savedAt }         (API only, so counts stay true)
users/{uid}/likes/{publicId}  { likedAt }         (API only)
reports/{id}            { publicRecipeId, kind: "report" | "claim", reason, contact?,
                          reporterUid?, status: "open" | "resolved", createdAt }
```

Rules: `publicRecipes` readable by anyone when `status == "live"` (or by its owner/admin);
everything else in this list is API-only, except a user reading their own `saves`/`likes`.

## API additions (Cloud Run)

| Route | Notes |
|---|---|
| `POST /recipes/:id/publish` {visibility, source, tags, startOffsetSeconds, handle?} | Owner only. oEmbed lookup for YouTube/TikTok (credit can't be typed wrong), duplicate-video check, handle reservation, Haiku screening (counts toward the $2/day budget, not the user's quota), writes the snapshot. Also used for "Update public version". Rate limit: 20 publishes/day/user. |
| `DELETE /recipes/:id/publish` | Unpublish (deletes snapshot + source mapping; saves show "no longer available"). |
| `POST /public/:id/save`, `DELETE …/save` | Bookmark + `stats.saves`/`score` in one transaction. |
| `POST /public/:id/like`, `DELETE …/like` | Like + `stats.likes`/`score` in one transaction; rate-limited. |
| `POST /public/:id/copy` | Private copy into the caller's library (`forkedFrom`), no Claude, no quota. |
| `POST /public/:id/report` {kind, reason, contact?} | Works signed out (App Check required); rate-limited per IP. |
| `GET /admin/queue`, `POST /admin/public/:id` {action} | Admin claim required. |
| `DELETE /me` | Extended: also removes the user's public recipes, handle, saves, likes (and decrements counts). |

New email alert: a log-based alert in Cloud Monitoring on "report created" / "publish flagged"
→ your email. No email service needed.

## Web additions

- Publish dialog, Public badge, Update/Unpublish actions on the recipe page.
- Explore page; public recipe page at `/r/{id}` (works signed out; the app learns path routes
  for this one page); embedded player with timestamp seeking; Like / Save / Make a copy / Report /
  Is this your video?
- Library gets a **Saved** section.
- Admin page (hidden unless admin).
- **Terms of use** page (new) and Privacy page update: what's public, creator rights,
  takedown contact, content rules.
- Signed-out landing gains "Browse recipes" so cooks can start without an account.
- `functions/r/[id].ts` (Cloudflare Pages Function) for link-preview meta tags.

## Order of work

1. Contract (`shared/public.ts`) + rules + rules tests — me.
2. In parallel on the emulators: **API** (publish, oEmbed, screening, saves, copy, reports,
   admin, deletion) and **web** (dialogs, Explore, public page + player, Saved, admin, terms),
   plus the Pages Function.
3. Integrate and test end to end locally (incl. a real YouTube oEmbed lookup).
4. Deploy rules/indexes, API, site; set your account as admin; publish a first recipe together.

Estimate: ~1.5–2 weeks of agent work.

## Costs

Reads grow with browsing (≈ 20 reads per Explore page, 2 per recipe view) — free tier covers
~2,500 recipe views/day; beyond that ≈ $0.06 per 100k reads. Screening ≈ 0.1¢ per publish.
Pages Function: free up to 100k requests/day. No change to the per-recipe Claude cost.

## Decisions (2026-10-09)

| Decision | Choice |
|---|---|
| Contact email for Terms / takedowns | **khechen2018@gmail.com for now** (`VITE_CONTACT_EMAIL`, one place to change when you create an alias) |
| Default visibility when publishing | **Public** |
| Edits to a published recipe | Stay private until **Update public version** |
| Appreciation | **Likes and saves** (Popular = likes + 2 × saves) |
