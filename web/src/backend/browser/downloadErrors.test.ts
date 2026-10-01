import { describe, expect, it } from "vitest";
import { MODEL_DOWNLOAD_INTERRUPTED_MESSAGE, describeTranscriptionError, isNetworkFailureMessage } from "./downloadErrors";

describe("isNetworkFailureMessage", () => {
  it("recognizes Chromium's fetch failure message", () => {
    expect(isNetworkFailureMessage("Failed to fetch")).toBe(true);
  });

  it("recognizes Firefox's fetch failure message", () => {
    expect(isNetworkFailureMessage("NetworkError when attempting to fetch resource.")).toBe(true);
  });

  it("recognizes Safari's fetch failure message", () => {
    expect(isNetworkFailureMessage("Load failed")).toBe(true);
  });

  it("recognizes common Chromium net:: error codes", () => {
    expect(isNetworkFailureMessage("net::ERR_INTERNET_DISCONNECTED")).toBe(true);
    expect(isNetworkFailureMessage("net::ERR_CONNECTION_RESET")).toBe(true);
  });

  it("is false for unrelated errors", () => {
    expect(isNetworkFailureMessage("Unexpected token < in JSON at position 0")).toBe(false);
    expect(isNetworkFailureMessage("whisper crashed")).toBe(false);
    expect(isNetworkFailureMessage("No API key configured")).toBe(false);
  });
});

describe("describeTranscriptionError", () => {
  it("rewrites a network-failure message to the clear, actionable one", () => {
    expect(describeTranscriptionError("Failed to fetch")).toBe(MODEL_DOWNLOAD_INTERRUPTED_MESSAGE);
  });

  it("leaves other error messages unchanged", () => {
    expect(describeTranscriptionError("The transcription worker crashed.")).toBe("The transcription worker crashed.");
  });

  it("doesn't claim a specific cause, and says progress is kept (chunks persist)", () => {
    expect(MODEL_DOWNLOAD_INTERRUPTED_MESSAGE).not.toMatch(/connection lost/i);
    expect(MODEL_DOWNLOAD_INTERRUPTED_MESSAGE).toMatch(/progress so far is kept/);
  });
});
