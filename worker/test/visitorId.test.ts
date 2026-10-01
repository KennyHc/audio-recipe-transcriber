import { describe, expect, it } from "vitest";
import { computeVisitorId } from "../src/visitorId";

describe("computeVisitorId", () => {
  it("returns a 64-char hex SHA-256 digest", async () => {
    const id = await computeVisitorId("1.2.3.4", "salt", "2026-10-01");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same inputs", async () => {
    const a = await computeVisitorId("1.2.3.4", "salt", "2026-10-01");
    const b = await computeVisitorId("1.2.3.4", "salt", "2026-10-01");
    expect(a).toBe(b);
  });

  it("differs when the IP differs", async () => {
    const a = await computeVisitorId("1.2.3.4", "salt", "2026-10-01");
    const b = await computeVisitorId("5.6.7.8", "salt", "2026-10-01");
    expect(a).not.toBe(b);
  });

  it("differs when the date differs (rolls over daily)", async () => {
    const a = await computeVisitorId("1.2.3.4", "salt", "2026-10-01");
    const b = await computeVisitorId("1.2.3.4", "salt", "2026-10-02");
    expect(a).not.toBe(b);
  });

  it("differs when the salt differs", async () => {
    const a = await computeVisitorId("1.2.3.4", "salt-a", "2026-10-01");
    const b = await computeVisitorId("1.2.3.4", "salt-b", "2026-10-01");
    expect(a).not.toBe(b);
  });

  it("never contains the raw IP as a substring (sanity check it's actually hashed)", async () => {
    const id = await computeVisitorId("1.2.3.4", "salt", "2026-10-01");
    expect(id).not.toContain("1.2.3.4");
  });
});
