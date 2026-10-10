import { describe, expect, it } from "vitest";
import { creatorHref, isPathRoute, linkNavigation, parseHash, parseLocation, publicHref } from "./router";

describe("parseLocation", () => {
  it("the /r/{id} path is the public recipe page, whatever the hash", () => {
    expect(parseLocation("/r/abc123", "")).toEqual({ name: "public", id: "abc123" });
    expect(parseLocation("/r/abc123/", "#/")).toEqual({ name: "public", id: "abc123" });
    expect(parseLocation("/r/a%20b", "")).toEqual({ name: "public", id: "a b" });
    expect(parseLocation("/r/%E0%A4%A", "")).toEqual({ name: "public", id: "%E0%A4%A" });
  });

  it("other paths fall back to the hash routes", () => {
    expect(parseLocation("/", "#/jobs/x1/cook")).toEqual({ name: "job", id: "x1", cook: true });
    expect(parseLocation("/", "#/explore")).toEqual({ name: "explore" });
    expect(parseLocation("/", "#/terms")).toEqual({ name: "terms" });
    expect(parseLocation("/", "#/admin")).toEqual({ name: "admin" });
    expect(parseLocation("/", "#/list")).toEqual({ name: "list" });
    expect(parseLocation("/", "")).toEqual({ name: "library" });
    expect(parseLocation("/r/", "#/settings")).toEqual({ name: "settings" });
    expect(parseLocation("/r/a/b", "")).toEqual({ name: "library" });
  });

  it("keeps the existing hash routes", () => {
    expect(parseHash("#/jobs/abc")).toEqual({ name: "job", id: "abc", cook: false });
    expect(parseHash("#/privacy")).toEqual({ name: "privacy" });
    expect(parseHash("#/nope")).toEqual({ name: "library" });
  });
});

describe("linkNavigation (in-app links between path and hash routes)", () => {
  it("public links are pushed (no full reload)", () => {
    expect(linkNavigation(publicHref("abc"), "/")).toEqual({ kind: "push", url: "/r/abc" });
    expect(linkNavigation("/r/xyz", "/r/abc")).toEqual({ kind: "push", url: "/r/xyz" });
  });

  it("hash links from a public page go back to the root path", () => {
    expect(linkNavigation("#/explore", "/r/abc")).toEqual({ kind: "push", url: "/#/explore" });
    expect(linkNavigation("#/", "/r/abc")).toEqual({ kind: "push", url: "/#/" });
    expect(linkNavigation("#", "/r/abc")).toEqual({ kind: "push", url: "/#/" });
  });

  it("hash links on the root path behave as plain hash changes", () => {
    expect(linkNavigation("#/explore", "/")).toEqual({ kind: "default" });
    expect(linkNavigation("https://youtu.be/x", "/r/abc")).toEqual({ kind: "default" });
    expect(linkNavigation("mailto:a@b.c", "/")).toEqual({ kind: "default" });
  });
});

describe("creator pages /@handle", () => {
  it("the /@handle path is the creator page, whatever the hash", () => {
    expect(parseLocation("/@chef_ann", "")).toEqual({ name: "creator", handle: "chef_ann" });
    expect(parseLocation("/@chef_ann/", "#/explore")).toEqual({ name: "creator", handle: "chef_ann" });
    expect(parseLocation("/%40chef_ann", "")).toEqual({ name: "creator", handle: "chef_ann" });
    expect(parseLocation("/@", "")).toEqual({ name: "library" });
    expect(parseLocation("/@a/b", "")).toEqual({ name: "library" });
    expect(isPathRoute("/@chef_ann")).toBe(true);
  });

  it("creatorHref builds the path, and in-app links to it are pushed", () => {
    expect(creatorHref("chef_ann")).toBe("/@chef_ann");
    expect(linkNavigation(creatorHref("chef_ann"), "/")).toEqual({ kind: "push", url: "/@chef_ann" });
    expect(linkNavigation("/r/abc", "/@chef_ann")).toEqual({ kind: "push", url: "/r/abc" });
  });

  it("hash links from a creator page go back to the root path", () => {
    expect(linkNavigation("#/explore", "/@chef_ann")).toEqual({ kind: "push", url: "/#/explore" });
  });
});
