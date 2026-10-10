import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { backend } from "@/backend";
import { IS_CLOUD, IS_HOSTED } from "@/lib/mode";
import { CONTACT_EMAIL } from "@/lib/contact";
import { termsHref } from "@/lib/router";

const LAST_UPDATED = "October 10, 2026";

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">
      {children}
    </h2>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[hsl(var(--accent-text))] underline underline-offset-2"
    >
      {children}
    </a>
  );
}

export function Privacy() {
  const isBrowserMode = backend.kind === "browser"; // covers both hosted and BYOK — see lib/mode.ts
  const isByok = isBrowserMode && !IS_HOSTED && !IS_CLOUD;
  const isLocalOnly = isBrowserMode && !IS_CLOUD; // BYOK and hosted: everything lives in IndexedDB
  const isLocalServer = backend.kind === "server";

  return (
    <div className="mx-auto max-w-[65ch] px-4 py-10 space-y-8">
      <a
        href="#/"
        className="inline-flex items-center gap-1 text-sm text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to library
      </a>

      <div className="space-y-1">
        <h1 className="font-serif text-[34px] sm:text-[40px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
          Privacy
        </h1>
        <p className="text-sm text-[hsl(var(--ink-faint))]">Last updated {LAST_UPDATED}</p>
      </div>

      <p className="text-[hsl(var(--ink))] leading-relaxed">
        This page explains what Recipe Transcriber does with your audio, transcripts, and
        recipes — in plain language, matching what the app actually does.
      </p>

      {IS_CLOUD && (
        <>
          <section className="space-y-2">
            <SectionLabel>What stays on your device</SectionLabel>
            <p className="text-[hsl(var(--ink))] leading-relaxed">
              Your audio never leaves your device. Speech-to-text runs in your browser: the
              speech model is downloaded from Hugging Face the first time you transcribe, cached
              in this browser, and runs entirely on your device. The audio file is kept in this
              browser (IndexedDB) so you can play it back from the recipe — on other devices the
              recipe shows without audio.
            </p>
          </section>

          <section className="space-y-2">
            <SectionLabel>What's stored in your account</SectionLabel>
            <p className="text-[hsl(var(--ink))] leading-relaxed">
              When you sign in (with Google or an emailed link), we store your account's email
              address, plus your name and profile picture if Google provides them. We also store
              your recipes, every saved version of them, their transcripts, your shopping list, and a
              count of how many recipes you've made this month (for the free limit).
            </p>
            <p className="text-[hsl(var(--ink))] leading-relaxed">
              This is kept in Google Cloud Firestore in the EU (Firebase, multi-region eur3), and
              is private: only you can read it when signed in. To keep the service from being
              abused, sign-in and requests are checked with Firebase App Check, which uses Google
              reCAPTCHA Enterprise.
            </p>
          </section>

          <section className="space-y-2">
            <SectionLabel>What's sent, and to whom</SectionLabel>
            <p className="text-[hsl(var(--ink))] leading-relaxed">
              To make a recipe, the transcript text is sent to our server (Google Cloud Run in the
              EU), which sends it to Anthropic's Claude API to extract the recipe and double-check
              it. The result is saved to your account. The audio is never uploaded.
            </p>
          </section>

          <section className="space-y-2">
            <SectionLabel>What's public when you publish</SectionLabel>
            <p className="text-[hsl(var(--ink))] leading-relaxed">
              Recipes are private unless you choose Publish. Publishing makes a public copy of the
              recipe (title, description, ingredients, steps, tips, and its double-check notes), the
              credit for where it came from (for videos: the title, channel, and thumbnail from YouTube
              or TikTok), the tags you picked, and your handle, shown as “Transcribed by @you”. Your
              email, name, photo, transcript, audio, and version history are never public. Public
              recipes can be read by anyone, including people who aren't signed in, and search
              engines. Unpublishing removes the public copy right away; so does deleting your account.
            </p>
            <p className="text-[hsl(var(--ink))] leading-relaxed">
              The rules for publishing are in the{" "}
              <a href={termsHref()} className="text-[hsl(var(--accent-text))] underline underline-offset-2">
                Terms of use
              </a>
              . Public pages embed the creator's YouTube video from youtube-nocookie.com, which loads
              only when the player comes into view or you press play.
            </p>
          </section>

          <section className="space-y-2">
            <SectionLabel>Likes, saves, and reports</SectionLabel>
            <p className="text-[hsl(var(--ink))] leading-relaxed">
              Which recipes you like or save is private to you; recipes only show the total counts.
              If you report a recipe or send a creator claim, we keep the reason and (if you give one)
              your email to handle it — they're seen only by us, never shown on the page. Reports work
              without an account; to limit abuse, we count them per day using a one-way hash of your
              IP address, never the address itself.
            </p>
          </section>

          <section className="space-y-2">
            <SectionLabel>Error reports</SectionLabel>
            <p className="text-[hsl(var(--ink))] leading-relaxed">
              When something breaks — a recipe fails to process, the speech model won't download, our
              server doesn't answer, or the page hits an unexpected error — your browser sends us a
              short error report so we can fix it. It contains only: the kind of error and the step
              it happened in (for example “transcribing”), an error code, a short error message with
              anything personal stripped out, which version of the app you're on, and basic facts
              about your browser and device (its user-agent string, whether it supports WebGPU, its
              approximate memory, and whether it's a phone). At most a few are sent per visit.
            </p>
            <p className="text-[hsl(var(--ink))] leading-relaxed">
              Error reports never include your audio, transcripts, recipe text, file names, email
              address, account or recipe ids, or web addresses. They aren't stored in your account or
              any database — they're written only to our server's logs (Google Cloud Logging), which
              keep them for 30 days and then delete them. Like reports, they're rate-limited using a
              one-way hash of your IP address, never the address itself.
            </p>
          </section>

          <section className="space-y-2">
            <SectionLabel>Download or delete anytime</SectionLabel>
            <p className="text-[hsl(var(--ink))] leading-relaxed">
              Settings → "Download all my data" gives you every recipe, version, and transcript as
              one file. Settings → "Delete my account" permanently deletes your account and
              everything in it, and clears this browser's local data. Deleting a single recipe
              deletes its versions and transcript too.
            </p>
          </section>
        </>
      )}

      {isLocalOnly && (
        <section className="space-y-2">
          <SectionLabel>What stays on your device</SectionLabel>
          <p className="text-[hsl(var(--ink))] leading-relaxed">
            Your audio file, its transcript, and every recipe and version you create are stored
            in this browser only (in IndexedDB) — they never leave your device unless the
            sections below say otherwise. The speech-to-text model is downloaded from Hugging
            Face the first time you transcribe, cached in this browser, and runs entirely on
            your device — your audio is never uploaded anywhere for transcription.
          </p>
          <p className="text-[hsl(var(--ink))] leading-relaxed">
            Your shopping list is kept in this browser's local storage. Settings → "Delete all
            local data" removes all of it: every recipe, transcript, and audio file, your shopping
            list, the downloaded speech model, and your saved settings.
          </p>
        </section>
      )}

      {IS_HOSTED && (
        <section className="space-y-2">
          <SectionLabel>What's sent, and to whom</SectionLabel>
          <p className="text-[hsl(var(--ink))] leading-relaxed">
            To turn your transcript into a recipe, the transcript text (and, for a quick
            double-check afterward, the recipe extracted from it) is sent to our server — a
            small Cloudflare Worker — which forwards it to Anthropic's Claude API to do the
            actual extraction and verification. The audio file itself is never uploaded; only
            the text of the transcript leaves your device.
          </p>
          <p className="text-[hsl(var(--ink))] leading-relaxed">
            Before each request, Cloudflare Turnstile runs an invisible bot check in your
            browser to confirm you're not a script.
          </p>
          <p className="text-[hsl(var(--ink))] leading-relaxed">
            Our server doesn't store transcripts or recipes, and doesn't log their contents —
            it only passes them through to Claude and returns the result. To enforce a daily
            free-use limit, it keeps a small counter per visitor, keyed by a one-way hash of
            your IP address combined with a secret value and today's date, so the key can't be
            turned back into your IP and is different every day. Your raw IP address is never
            stored.
          </p>
        </section>
      )}

      {isByok && (
        <section className="space-y-2">
          <SectionLabel>Your API key, your request</SectionLabel>
          <p className="text-[hsl(var(--ink))] leading-relaxed">
            This build sends the transcript directly from your browser to Anthropic, using the
            API key you entered in Settings — there's no server in between. That key is stored
            only in this browser (never sent anywhere except to Anthropic's API) and is never
            seen by us.
          </p>
        </section>
      )}

      {isLocalServer && (
        <section className="space-y-2">
          <SectionLabel>What stays on this machine</SectionLabel>
          <p className="text-[hsl(var(--ink))] leading-relaxed">
            This build runs as a local server: your audio, transcript, and recipe files are
            stored as plain files on the machine running the server — nothing is uploaded to
            us. The one exception is the transcript, which is sent to Anthropic to produce and
            verify the recipe.
          </p>
        </section>
      )}

      <section className="space-y-2">
        <SectionLabel>Third parties</SectionLabel>
        <ul className="list-disc pl-5 space-y-1.5 text-[hsl(var(--ink))] leading-relaxed">
          <li>
            <strong>Anthropic</strong> — makes the Claude models that turn your transcript into
            a recipe and double-check it.{" "}
            <ExternalLink href="https://www.anthropic.com/legal/privacy">Anthropic's privacy policy</ExternalLink>
          </li>
          {IS_CLOUD && (
            <li>
              <strong>Google</strong> — Firebase Authentication (sign-in), Cloud Firestore (your
              recipes, in the EU), Cloud Run (our server), and App Check with reCAPTCHA Enterprise.{" "}
              <ExternalLink href="https://firebase.google.com/support/privacy">Firebase privacy and security</ExternalLink>
            </li>
          )}
          {IS_CLOUD && (
            <li>
              <strong>Cloudflare</strong> — hosts this site (Pages).{" "}
              <ExternalLink href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</ExternalLink>
            </li>
          )}
          {IS_HOSTED && (
            <li>
              <strong>Cloudflare</strong> — hosts this site and the small API server (Workers,
              Pages) and runs the Turnstile bot check.{" "}
              <ExternalLink href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</ExternalLink>
            </li>
          )}
          {isBrowserMode && (
            <>
              <li>
                <strong>Hugging Face</strong> — hosts the speech-to-text model your browser
                downloads.{" "}
                <ExternalLink href="https://huggingface.co/privacy">Hugging Face's privacy policy</ExternalLink>
              </li>
              <li>
                <strong>jsDelivr</strong> — a public CDN that serves the speech-recognition
                engine's runtime file to your browser.
              </li>
            </>
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <SectionLabel>{IS_CLOUD ? "No ads, no tracking" : "No accounts, no ads, no tracking"}</SectionLabel>
        <p className="text-[hsl(var(--ink))] leading-relaxed">
          {IS_CLOUD
            ? "There's no advertising, and no analytics or tracking cookies. Your recipes are never shared or made public unless you publish them. Your theme choice and settings live in this browser's local storage; signing in keeps a session in this browser."
            : "There's no sign-up, no advertising, and no analytics or tracking cookies. Your theme choice and settings live in this browser's local storage, not on any server."}
        </p>
      </section>

      <section className="space-y-2">
        <SectionLabel>Contact</SectionLabel>
        {IS_CLOUD && CONTACT_EMAIL && (
          <p className="text-[hsl(var(--ink))] leading-relaxed">
            Privacy questions, data requests, or takedowns: email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[hsl(var(--accent-text))] underline underline-offset-2">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        )}
        <p className="text-[hsl(var(--ink))] leading-relaxed">
          Questions? Open an issue on{" "}
          <ExternalLink href="https://github.com/KennyHc/audio-recipe-transcriber/issues">
            GitHub
          </ExternalLink>
          .
        </p>
      </section>
    </div>
  );
}
