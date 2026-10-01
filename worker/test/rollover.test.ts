import { describe, expect, it } from "vitest";
import { secondsUntilNextUtcMidnight, utcDateString } from "../src/rollover";

describe("utcDateString", () => {
  it("formats as YYYY-MM-DD in UTC", () => {
    expect(utcDateString(new Date("2026-10-01T23:59:59.000Z"))).toBe("2026-10-01");
  });
});

describe("secondsUntilNextUtcMidnight", () => {
  it("counts down to the next UTC midnight", () => {
    const now = new Date("2026-10-01T23:59:00.000Z");
    expect(secondsUntilNextUtcMidnight(now)).toBe(60);
  });

  it("is a full day right after midnight", () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    expect(secondsUntilNextUtcMidnight(now)).toBe(24 * 60 * 60);
  });

  it("never returns zero or negative", () => {
    const now = new Date("2026-10-01T23:59:59.999Z");
    expect(secondsUntilNextUtcMidnight(now)).toBeGreaterThanOrEqual(1);
  });
});
