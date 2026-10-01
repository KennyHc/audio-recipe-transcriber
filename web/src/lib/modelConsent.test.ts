import { describe, expect, it } from "vitest";
import { decideModelReadiness, shouldRecommendWifi, shouldShowModelConsentDialog } from "./modelConsent";

describe("shouldShowModelConsentDialog", () => {
  it("shows the dialog when the model is not cached", () => {
    expect(shouldShowModelConsentDialog({ isCached: false })).toBe(true);
  });

  it("does not show the dialog once the model is cached", () => {
    expect(shouldShowModelConsentDialog({ isCached: true })).toBe(false);
  });
});

describe("shouldRecommendWifi", () => {
  it("is false when connection info is unavailable", () => {
    expect(shouldRecommendWifi(null)).toBe(false);
    expect(shouldRecommendWifi(undefined)).toBe(false);
  });

  it("is false on a fast, non-data-saver connection", () => {
    expect(shouldRecommendWifi({ saveData: false, effectiveType: "4g" })).toBe(false);
  });

  it("is true when Data Saver is on regardless of effective type", () => {
    expect(shouldRecommendWifi({ saveData: true, effectiveType: "4g" })).toBe(true);
  });

  it("is true on 2g/3g/slow-2g effective types", () => {
    expect(shouldRecommendWifi({ effectiveType: "2g" })).toBe(true);
    expect(shouldRecommendWifi({ effectiveType: "3g" })).toBe(true);
    expect(shouldRecommendWifi({ effectiveType: "slow-2g" })).toBe(true);
  });

  it("is false on unrecognized effective types with no data saver flag", () => {
    expect(shouldRecommendWifi({ effectiveType: "unknown" })).toBe(false);
  });
});

describe("decideModelReadiness", () => {
  it("is ready when cached, even without consent this session", () => {
    expect(decideModelReadiness({ isCached: true, consentedThisSession: false })).toBe("ready");
  });

  it("is ready once the user has consented this session, even if not yet cached", () => {
    expect(decideModelReadiness({ isCached: false, consentedThisSession: true })).toBe("ready");
  });

  it("waits for consent when neither cached nor consented", () => {
    expect(decideModelReadiness({ isCached: false, consentedThisSession: false })).toBe("waiting-for-consent");
  });
});
