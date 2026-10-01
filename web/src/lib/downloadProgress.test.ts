import { describe, expect, it } from "vitest";
import {
  aggregateBytes,
  estimateEtaSeconds,
  estimateRateBytesPerSec,
  formatDownloadLabel,
  formatEta,
  formatMB,
  formatRate,
  pushRateSample,
  shouldEmitProgressUpdate,
  RATE_STABLE_WINDOW_MS,
  type RateSample,
} from "./downloadProgress";

describe("aggregateBytes", () => {
  it("sums loaded/total across a Map of files", () => {
    const files = new Map([
      ["a", { loaded: 100, total: 400 }],
      ["b", { loaded: 200, total: 600 }],
    ]);
    expect(aggregateBytes(files)).toEqual({ loaded: 300, total: 1000 });
  });

  it("sums loaded/total across an array of files", () => {
    expect(aggregateBytes([{ loaded: 1, total: 2 }, { loaded: 3, total: 4 }])).toEqual({ loaded: 4, total: 6 });
  });

  it("returns zeros for no files", () => {
    expect(aggregateBytes([])).toEqual({ loaded: 0, total: 0 });
  });
});

describe("pushRateSample / estimateRateBytesPerSec", () => {
  it("returns null with fewer than 2 samples", () => {
    expect(estimateRateBytesPerSec([])).toBeNull();
    expect(estimateRateBytesPerSec([{ t: 0, bytes: 0 }])).toBeNull();
  });

  it("returns null when the sample window is shorter than the stability threshold", () => {
    const samples: RateSample[] = [
      { t: 0, bytes: 0 },
      { t: 500, bytes: 500_000 },
    ];
    expect(estimateRateBytesPerSec(samples)).toBeNull();
  });

  it("estimates bytes/sec once the window spans the stability threshold", () => {
    const samples: RateSample[] = [
      { t: 0, bytes: 0 },
      { t: RATE_STABLE_WINDOW_MS, bytes: RATE_STABLE_WINDOW_MS /* 1 byte/ms == 1000 B/s */ },
    ];
    expect(estimateRateBytesPerSec(samples)).toBeCloseTo(1000, 5);
  });

  it("drops samples older than the retention window relative to the newest sample", () => {
    let samples: RateSample[] = [];
    samples = pushRateSample(samples, { t: 0, bytes: 0 }, 1000);
    samples = pushRateSample(samples, { t: 2000, bytes: 2_000_000 }, 1000);
    // the t:0 sample is now older than (2000 - 1000), so it should have been dropped
    expect(samples).toEqual([{ t: 2000, bytes: 2_000_000 }]);
  });

  it("never returns a negative rate when bytes appear to go backwards (e.g. a cache re-check)", () => {
    const samples: RateSample[] = [
      { t: 0, bytes: 1000 },
      { t: RATE_STABLE_WINDOW_MS, bytes: 500 },
    ];
    expect(estimateRateBytesPerSec(samples)).toBe(0);
  });
});

describe("estimateEtaSeconds", () => {
  it("is null when the rate is unknown", () => {
    expect(estimateEtaSeconds(1000, null)).toBeNull();
  });

  it("is null when the rate is zero or negative", () => {
    expect(estimateEtaSeconds(1000, 0)).toBeNull();
    expect(estimateEtaSeconds(1000, -5)).toBeNull();
  });

  it("computes remaining seconds at a positive rate", () => {
    expect(estimateEtaSeconds(1000, 100)).toBe(10);
  });

  it("is 0 when nothing remains", () => {
    expect(estimateEtaSeconds(0, 100)).toBe(0);
  });
});

describe("formatMB / formatRate / formatEta", () => {
  it("formats megabytes rounded to whole numbers", () => {
    expect(formatMB(312 * 1_000_000)).toBe("312 MB");
    expect(formatMB(0)).toBe("0 MB");
  });

  it("formats a rate to one decimal place", () => {
    expect(formatRate(2.1 * 1_000_000)).toBe("2.1 MB/s");
  });

  it("floors very small rates to a readable minimum instead of 0.0", () => {
    expect(formatRate(1024)).toBe("<0.1 MB/s");
  });

  it("formats sub-minute ETAs in seconds and longer ones in minutes", () => {
    expect(formatEta(40)).toBe("~40 sec left");
    expect(formatEta(125)).toBe("~2 min left");
  });
});

describe("formatDownloadLabel", () => {
  it("matches the full label shape once rate and ETA are known", () => {
    const label = formatDownloadLabel({
      loadedBytes: 312 * 1_000_000,
      totalBytes: 640 * 1_000_000,
      bytesPerSecond: 2.1 * 1_000_000,
      etaSeconds: 120,
    });
    expect(label).toBe("Downloading speech model (once) — 312 of 640 MB · 2.1 MB/s · ~2 min left");
  });

  it("omits rate and ETA until they are known", () => {
    const label = formatDownloadLabel({
      loadedBytes: 10 * 1_000_000,
      totalBytes: 640 * 1_000_000,
      bytesPerSecond: null,
      etaSeconds: null,
    });
    expect(label).toBe("Downloading speech model (once) — 10 of 640 MB");
  });

  it("shows the rate without an ETA if the ETA specifically is unknown", () => {
    const label = formatDownloadLabel({
      loadedBytes: 10 * 1_000_000,
      totalBytes: 640 * 1_000_000,
      bytesPerSecond: 2 * 1_000_000,
      etaSeconds: null,
    });
    expect(label).toBe("Downloading speech model (once) — 10 of 640 MB · 2.0 MB/s");
  });
});

describe("shouldEmitProgressUpdate", () => {
  it("throttles to at most ~4 updates/sec by default (250ms)", () => {
    expect(shouldEmitProgressUpdate(1000, 1100)).toBe(false);
    expect(shouldEmitProgressUpdate(1000, 1250)).toBe(true);
    expect(shouldEmitProgressUpdate(1000, 1400)).toBe(true);
  });

  it("always emits when forced, regardless of timing", () => {
    expect(shouldEmitProgressUpdate(1000, 1001, 250, true)).toBe(true);
  });
});
