import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config";

const KEY = { ANTHROPIC_API_KEY: "test-key-not-real" };

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({ ...KEY });
    expect(c).toEqual({
      anthropicApiKey: "test-key-not-real",
      extractorModel: "claude-haiku-4-5",
      verifierModel: "claude-haiku-4-5",
      dailyBudgetUsd: 2,
      freeMonthlyRecipes: 30,
      allowedOrigins: ["https://recipe-transcriber.pages.dev"],
      requireAppCheck: true,
    });
  });

  it("reads overrides and a comma-separated origin list", () => {
    const c = loadConfig({
      ...KEY,
      EXTRACTOR_MODEL: "claude-sonnet-5",
      DAILY_BUDGET_USD: "0.5",
      FREE_MONTHLY_RECIPES: "10",
      ALLOWED_ORIGINS: "https://a.example, https://b.example:8443",
    });
    expect(c.extractorModel).toBe("claude-sonnet-5");
    expect(c.verifierModel).toBe("claude-haiku-4-5");
    expect(c.dailyBudgetUsd).toBe(0.5);
    expect(c.freeMonthlyRecipes).toBe(10);
    expect(c.allowedOrigins).toEqual(["https://a.example", "https://b.example:8443"]);
  });

  it("refuses to start without the API key", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ ANTHROPIC_API_KEY: "  " })).toThrow(ConfigError);
  });

  it.each([
    ["DAILY_BUDGET_USD", "abc"],
    ["DAILY_BUDGET_USD", "-1"],
    ["DAILY_BUDGET_USD", "Infinity"],
    ["FREE_MONTHLY_RECIPES", "2.5"],
    ["FREE_MONTHLY_RECIPES", "lots"],
    ["REQUIRE_APP_CHECK", "no"],
    ["ALLOWED_ORIGINS", "https://a.example/path"],
  ])("refuses invalid %s=%s", (name, value) => {
    expect(() => loadConfig({ ...KEY, [name]: value })).toThrow(ConfigError);
  });

  it("never echoes the key in its error message", () => {
    try {
      loadConfig({ ANTHROPIC_API_KEY: "sk-ant-secret", DAILY_BUDGET_USD: "x" });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain("sk-ant-secret");
    }
  });

  it("allows REQUIRE_APP_CHECK=false only against the emulator", () => {
    expect(() => loadConfig({ ...KEY, REQUIRE_APP_CHECK: "false" })).toThrow(/FIRESTORE_EMULATOR_HOST/);
    const c = loadConfig({ ...KEY, REQUIRE_APP_CHECK: "false", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
    expect(c.requireAppCheck).toBe(false);
  });

  it("adds the local Vite origins only against the emulator", () => {
    expect(loadConfig({ ...KEY }).allowedOrigins).not.toContain("http://localhost:5180");
    const dev = loadConfig({ ...KEY, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }).allowedOrigins;
    expect(dev).toEqual(
      expect.arrayContaining([
        "https://recipe-transcriber.pages.dev",
        "http://localhost:5180",
        "http://localhost:5184",
      ]),
    );
  });
});
