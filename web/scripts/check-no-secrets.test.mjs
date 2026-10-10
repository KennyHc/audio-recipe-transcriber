import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { missingCloudEnv, parseDotenv, resolveViteEnv, scan } from "./check-no-secrets.mjs";

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "check-no-secrets.mjs");

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "check-no-secrets-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relPath, content) {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("scan", () => {
  it("passes a clean bundle with no findings", () => {
    write("index.html", "<!doctype html><html></html>");
    write("assets/main.js", "console.log('hello world');");

    const { files, findings } = scan(dir, { hostedMode: true });

    expect(findings).toEqual([]);
    expect(files.length).toBe(2);
  });

  it("flags an embedded Anthropic key, in any mode", () => {
    write("assets/main.js", 'const leaked = "sk-ant-api03-abcdefghijklmnop";');

    const notHosted = scan(dir, { hostedMode: false });
    expect(notHosted.findings).toHaveLength(1);
    expect(notHosted.findings[0]).toMatch(/looks like an Anthropic API key/);

    const hosted = scan(dir, { hostedMode: true });
    expect(hosted.findings).toHaveLength(1);
  });

  it("flags api.anthropic.com only in hosted mode", () => {
    write("assets/main.js", 'fetch("https://api.anthropic.com/v1/messages")');

    const notHosted = scan(dir, { hostedMode: false });
    expect(notHosted.findings).toEqual([]);

    const hosted = scan(dir, { hostedMode: true });
    expect(hosted.findings).toHaveLength(1);
    expect(hosted.findings[0]).toMatch(/api\.anthropic\.com/);
  });

  it("recurses into nested directories", () => {
    write("assets/chunks/deep/nested.js", 'const k = "sk-ant-deepsecretvalue";');

    const { findings } = scan(dir, { hostedMode: false });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/^assets[\\/]chunks[\\/]deep[\\/]nested\.js:/);
  });

  it("ignores non-text file extensions (e.g. fonts, images)", () => {
    write("assets/font.woff2", "sk-ant-shouldnotbescanned");
    write("assets/logo.png", "api.anthropic.com shouldnotbescanned");

    const { files, findings } = scan(dir, { hostedMode: true });
    expect(files).toEqual([]);
    expect(findings).toEqual([]);
  });

  it("reports multiple findings across multiple files", () => {
    write("a.js", 'const k = "sk-ant-aaaaaaaaaaaa";');
    write("b.js", 'fetch("https://api.anthropic.com")');

    const { findings } = scan(dir, { hostedMode: true });
    expect(findings).toHaveLength(2);
  });
});

describe("CLI (--dir, --hosted, exit codes)", () => {
  it("exits 0 with a PASS line on a clean directory", () => {
    write("index.html", "<!doctype html><html></html>");
    const result = spawnSync("node", [SCRIPT_PATH, "--dir", dir, "--hosted"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/check-no-secrets: PASS/);
  });

  it("exits 1 and prints findings when a key is present", () => {
    write("main.js", 'const k = "sk-ant-cliexitcodecheck";');
    const result = spawnSync("node", [SCRIPT_PATH, "--dir", dir], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/FAILED/);
    expect(result.stderr).toMatch(/looks like an Anthropic API key/);
  });

  it("exits 1 when the target directory doesn't exist", () => {
    const result = spawnSync("node", [SCRIPT_PATH, "--dir", join(dir, "does-not-exist")], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not exist/);
  });
});

describe("cloud build env (VITE_CONTACT_EMAIL)", () => {
  it("parses dotenv lines with quotes and comments", () => {
    expect(parseDotenv('# c\nA=1\nB="two words"\nC=x # note\nexport D=4\n')).toEqual({ A: "1", B: "two words", C: "x", D: "4" });
  });

  it("resolves like Vite: process env, then .env.cloud.local, .env.cloud, .env.local, .env", () => {
    write(".env", "VITE_CONTACT_EMAIL=base@example.com");
    write(".env.cloud", "VITE_CONTACT_EMAIL=mode@example.com");
    expect(resolveViteEnv("VITE_CONTACT_EMAIL", { mode: "cloud", dir, env: {} })).toBe("mode@example.com");
    write(".env.cloud.local", "VITE_CONTACT_EMAIL=local@example.com");
    expect(resolveViteEnv("VITE_CONTACT_EMAIL", { mode: "cloud", dir, env: {} })).toBe("local@example.com");
    expect(resolveViteEnv("VITE_CONTACT_EMAIL", { mode: "cloud", dir, env: { VITE_CONTACT_EMAIL: "env@example.com" } })).toBe(
      "env@example.com",
    );
  });

  it("reports an empty or missing contact email", () => {
    expect(missingCloudEnv({ dir, env: {} })).toEqual(["VITE_CONTACT_EMAIL"]);
    write(".env.cloud.local", "VITE_CONTACT_EMAIL=");
    expect(missingCloudEnv({ dir, env: {} })).toEqual(["VITE_CONTACT_EMAIL"]);
    expect(missingCloudEnv({ dir, env: { VITE_CONTACT_EMAIL: "me@example.com" } })).toEqual([]);
  });

  it("--cloud exits 1 when it's empty and 0 when it's set", () => {
    write("index.html", "<!doctype html><html></html>");
    const empty = spawnSync("node", [SCRIPT_PATH, "--dir", dir, "--cloud"], {
      encoding: "utf8",
      env: { ...process.env, VITE_CONTACT_EMAIL: "" },
    });
    expect(empty.status).toBe(1);
    expect(empty.stderr).toMatch(/VITE_CONTACT_EMAIL is empty/);
    const set = spawnSync("node", [SCRIPT_PATH, "--dir", dir, "--cloud"], {
      encoding: "utf8",
      env: { ...process.env, VITE_CONTACT_EMAIL: "me@example.com" },
    });
    expect(set.status).toBe(0);
  });
});
