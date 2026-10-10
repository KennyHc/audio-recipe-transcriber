import { describe, expect, it } from "vitest";
import {
  buildPreviewMeta,
  canonicalPageUrl,
  escapeHtml,
  firestoreDocUrl,
  fromFirestoreValue,
  isPlausibleId,
  previewDescription,
  previewFromFirestoreDoc,
  renderMetaTags,
} from "./previewMeta";

const s = (v: string) => ({ stringValue: v });
const NULL = { nullValue: null };

function restDoc(patch: Record<string, unknown> = {}, sourcePatch: Record<string, unknown> = {}) {
  return {
    name: "projects/p/databases/(default)/documents/publicRecipes/r1",
    fields: {
      status: s("live"),
      visibility: s("public"),
      handle: s("kenny"),
      recipe: {
        mapValue: {
          fields: {
            title: s("Egg Fried Rice"),
            description: s("Quick and easy."),
            ingredients: { arrayValue: { values: [{ mapValue: { fields: { item: s("rice") } } }, { mapValue: { fields: { item: s("egg") } } }] } },
          },
        },
      },
      source: {
        mapValue: {
          fields: {
            kind: s("video"),
            channelName: s("Chef <Lee> & \"Co\""),
            thumbnailUrl: s("https://i.ytimg.com/vi/abc/hqdefault.jpg"),
            startOffsetSeconds: { integerValue: "0" },
            ...sourcePatch,
          },
        },
      },
      stats: { mapValue: { fields: { likes: { integerValue: "3" } } } },
      ...patch,
    },
  };
}

describe("Firestore REST values", () => {
  it("converts typed values", () => {
    expect(fromFirestoreValue({ integerValue: "42" })).toBe(42);
    expect(fromFirestoreValue({ booleanValue: true })).toBe(true);
    expect(fromFirestoreValue(NULL)).toBeNull();
    expect(fromFirestoreValue({ arrayValue: {} })).toEqual([]);
    expect(fromFirestoreValue({ mapValue: { fields: { a: s("b") } } })).toEqual({ a: "b" });
  });
  it("builds the document URL and checks ids", () => {
    expect(firestoreDocUrl("recipe-transcriber-eu", "abc")).toBe(
      "https://firestore.googleapis.com/v1/projects/recipe-transcriber-eu/databases/(default)/documents/publicRecipes/abc",
    );
    expect(isPlausibleId("abc-DEF_123")).toBe(true);
    expect(isPlausibleId("../etc")).toBe(false);
    expect(isPlausibleId("")).toBe(false);
  });
});

describe("previewFromFirestoreDoc", () => {
  it("reads a live recipe", () => {
    expect(previewFromFirestoreDoc(restDoc())).toEqual({
      title: "Egg Fried Rice",
      description: "Quick and easy.",
      channelName: 'Chef <Lee> & "Co"',
      handle: "kenny",
      thumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      ingredientCount: 2,
      visibility: "public",
    });
  });
  it("is null when not live or malformed", () => {
    expect(previewFromFirestoreDoc(restDoc({ status: s("review") }))).toBeNull();
    expect(previewFromFirestoreDoc(restDoc({ status: s("hidden") }))).toBeNull();
    expect(previewFromFirestoreDoc({})).toBeNull();
    expect(previewFromFirestoreDoc(null)).toBeNull();
  });
  it("drops non-https thumbnails; own recipes have no channel", () => {
    expect(previewFromFirestoreDoc(restDoc({}, { thumbnailUrl: s("javascript:alert(1)") }))?.thumbnailUrl).toBeNull();
    const own = previewFromFirestoreDoc(restDoc({}, { kind: s("own"), channelName: NULL }))!;
    expect(previewDescription(own)).toBe("Recipe by @kenny · 2 ingredients");
  });
});

describe("buildPreviewMeta + renderMetaTags", () => {
  const info = previewFromFirestoreDoc(restDoc())!;

  it("has og:title/description/image/url and twitter:card", () => {
    const meta = buildPreviewMeta(info, "https://recipe-transcriber.pages.dev/r/r1");
    const byKey = Object.fromEntries(meta.tags.map((t) => [t.key, t.content]));
    expect(byKey["og:title"]).toBe("Egg Fried Rice");
    expect(byKey["og:description"]).toBe('Recipe by Chef <Lee> & "Co" · 2 ingredients');
    expect(byKey["og:image"]).toBe("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    expect(byKey["og:url"]).toBe("https://recipe-transcriber.pages.dev/r/r1");
    expect(byKey["twitter:card"]).toBe("summary_large_image");
    expect(byKey.robots).toBeUndefined();
    expect(meta.title).toBe("Egg Fried Rice · Recipe Transcriber");
  });

  it("escapes everything it renders", () => {
    const html = renderMetaTags(buildPreviewMeta({ ...info, title: '"><script>alert(1)</script>' }, "https://x.dev/r/r1").tags);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    expect(html).toContain("Chef &lt;Lee&gt; &amp; &quot;Co&quot;");
    expect(escapeHtml(`<a href='x'>&</a>`)).toBe("&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;");
  });

  it("unlisted pages say noindex; no thumbnail → small card", () => {
    const meta = buildPreviewMeta({ ...info, visibility: "unlisted", thumbnailUrl: null }, "https://x.dev/r/r1");
    const byKey = Object.fromEntries(meta.tags.map((t) => [t.key, t.content]));
    expect(byKey.robots).toBe("noindex");
    expect(byKey["twitter:card"]).toBe("summary");
    expect(byKey["og:image"]).toBeUndefined();
  });

  it("canonical URL drops query and hash", () => {
    expect(canonicalPageUrl("https://x.dev/r/r1?utm=1#/", "r1")).toBe("https://x.dev/r/r1");
  });
});
