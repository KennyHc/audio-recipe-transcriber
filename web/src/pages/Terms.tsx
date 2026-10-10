import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { CONTACT_EMAIL } from "@/lib/contact";
import { privacyHref } from "@/lib/router";

const LAST_UPDATED = "October 9, 2026";

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">{children}</h2>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[hsl(var(--ink))] leading-relaxed">{children}</p>;
}

function Contact() {
  if (!CONTACT_EMAIL) return <>the contact address on this page</>;
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-[hsl(var(--accent-text))] underline underline-offset-2">
      {CONTACT_EMAIL}
    </a>
  );
}

/** Terms of use, in plain language (cloud mode: publishing and the public recipe bank). */
export function Terms() {
  return (
    <div className="mx-auto max-w-[65ch] px-4 py-10 space-y-8">
      <a
        href="#/"
        className="inline-flex items-center gap-1 text-sm text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </a>

      <div className="space-y-1">
        <h1 className="font-serif text-[34px] sm:text-[40px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
          Terms of use
        </h1>
        <p className="text-sm text-[hsl(var(--ink-faint))]">Last updated {LAST_UPDATED}</p>
      </div>

      <P>
        Recipe Transcriber turns cooking audio into written recipes. These terms explain the few rules for using it —
        especially for publishing recipes to the public recipe bank. By using the app you agree to them.
      </P>

      <section className="space-y-2">
        <SectionLabel>Your recipes are private unless you publish</SectionLabel>
        <P>
          Everything you make starts private: only you can see it. Nothing becomes public unless you choose{" "}
          <em>Publish</em>. You can unpublish at any time, and the public page disappears right away.
        </P>
      </section>

      <section className="space-y-2">
        <SectionLabel>What gets published</SectionLabel>
        <P>
          When you publish, we make a public copy of the recipe as it is at that moment — title, description,
          ingredients, steps, tips, and its “double-check” notes — plus the credit for where it came from, the tags you
          picked, and your handle (shown as “Transcribed by @you”). Your transcript, audio, and version history are{" "}
          <strong>never</strong> published. Later edits stay private until you choose <em>Update public version</em>.
        </P>
        <P>
          You can publish to everyone (listed in the bank and search) or to <em>anyone with the link</em> (not listed).
          Other people can like, save, and make their own private copy of a public recipe.
        </P>
      </section>

      <section className="space-y-2">
        <SectionLabel>Credit comes first</SectionLabel>
        <P>
          Most recipes here come from cooking videos, and the cooks who made them deserve the credit. So a recipe from a
          video must link to that video. For YouTube and TikTok we fill in the title, channel, and thumbnail ourselves,
          straight from the platform, so the credit is accurate. The page leads with “Recipe by {"{"}channel{"}"}”, shows the
          original video where the creator allows embedding, and every timestamp jumps to that moment in their video. You
          appear as the person who transcribed it, never as the author.
        </P>
        <P>
          We never re-host anyone's audio or video — only the written recipe. Only publish recipes you're allowed to
          share, with honest credit. You're responsible for what you publish.
        </P>
        <P>One page per video: if a video already has a recipe in the bank, we'll point you to it instead.</P>
      </section>

      <section className="space-y-2">
        <SectionLabel>Creators: your rights, takedowns, and claims</SectionLabel>
        <P>
          If a recipe comes from your video and you'd like it removed, or credited differently, use{" "}
          <em>Is this your video?</em> on its page, or email <Contact />. Tell us which page and what you'd like; we may
          ask you to confirm the channel is yours. We handle requests within a few days and hide the page while we look
          into a takedown request. This address is also our contact for copyright notices.
        </P>
      </section>

      <section className="space-y-2">
        <SectionLabel>Content rules</SectionLabel>
        <ul className="list-disc pl-5 space-y-1.5 text-[hsl(var(--ink))] leading-relaxed">
          <li>Real recipes only — food or drink someone can actually make.</li>
          <li>No spam, ads, or links that aren't the recipe's source.</li>
          <li>No abuse, hate, harassment, or anything unsafe or illegal.</li>
          <li>Respect creators: honest credit, no passing off someone else's recipe as your own.</li>
          <li>Pick a handle that isn't offensive and doesn't pretend to be someone else.</li>
        </ul>
        <P>
          New and updated public recipes get a quick automatic check; anything flagged waits for a person to look at it.
          Anyone can report a recipe from its page.
        </P>
      </section>

      <section className="space-y-2">
        <SectionLabel>We may hide content</SectionLabel>
        <P>
          We can hide or remove a public recipe, or limit an account, if it breaks these rules, after a valid creator
          request, or when we have to by law. A hidden recipe stays in your private library. Likes and saves have daily
          limits to keep things fair.
        </P>
      </section>

      <section className="space-y-2">
        <SectionLabel>The service</SectionLabel>
        <P>
          Recipes are made by AI from what was said, and can contain mistakes — check quantities, temperatures, and
          allergens before you cook. The app is provided as is, free, with limits that may change. Your privacy is covered
          on the{" "}
          <a href={privacyHref()} className="text-[hsl(var(--accent-text))] underline underline-offset-2">
            Privacy
          </a>{" "}
          page.
        </P>
      </section>

      <section className="space-y-2">
        <SectionLabel>Contact</SectionLabel>
        <P>
          Questions, takedown requests, or copyright notices: <Contact />.
        </P>
      </section>
    </div>
  );
}
