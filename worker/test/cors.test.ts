import { describe, expect, it } from "vitest";
import { corsHeadersFor, isOriginAllowed, parseAllowedOrigins } from "../src/cors";

describe("parseAllowedOrigins", () => {
  it("splits, trims, and drops empty entries", () => {
    expect(parseAllowedOrigins("http://a.test, http://b.test ,,")).toEqual([
      "http://a.test",
      "http://b.test",
    ]);
  });

  it("returns an empty array for an empty var", () => {
    expect(parseAllowedOrigins("")).toEqual([]);
  });
});

describe("isOriginAllowed", () => {
  const allowed = ["http://localhost:5182", "http://localhost:5183"];

  it("accepts a listed origin", () => {
    expect(isOriginAllowed("http://localhost:5182", allowed)).toBe(true);
  });

  it("rejects an unlisted origin", () => {
    expect(isOriginAllowed("http://evil.example", allowed)).toBe(false);
  });

  it("rejects a null origin", () => {
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });
});

describe("corsHeadersFor", () => {
  const allowed = ["http://localhost:5182"];

  it("reflects an allowed origin and lists the expected methods/headers", () => {
    const headers = corsHeadersFor("http://localhost:5182", allowed);
    expect(headers).not.toBeNull();
    expect(headers!["Access-Control-Allow-Origin"]).toBe("http://localhost:5182");
    expect(headers!["Access-Control-Allow-Methods"]).toContain("POST");
    expect(headers!["Access-Control-Allow-Headers"]).toContain("X-Turnstile-Token");
  });

  it("returns null for a disallowed origin", () => {
    expect(corsHeadersFor("http://evil.example", allowed)).toBeNull();
  });

  it("returns null when there is no origin header", () => {
    expect(corsHeadersFor(null, allowed)).toBeNull();
  });
});
