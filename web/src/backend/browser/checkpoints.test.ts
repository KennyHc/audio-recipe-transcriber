import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { clearCheckpoint, deleteAllCheckpoints, getCheckpoint, noteAutoResume, resetAutoResumes } from "./checkpoints";

afterEach(async () => {
  await deleteAllCheckpoints();
});

describe("automatic-restart counter", () => {
  it("counts automatic restarts and resets them on Retry", async () => {
    expect(await noteAutoResume("job2")).toBe(1);
    expect(await noteAutoResume("job2")).toBe(2);
    await resetAutoResumes("job2");
    expect((await getCheckpoint("job2"))?.autoResumes).toBe(0);
  });

  it("clears one job, or everything", async () => {
    await noteAutoResume("a");
    await noteAutoResume("b");
    await clearCheckpoint("a");
    expect(await getCheckpoint("a")).toBeNull();
    expect(await getCheckpoint("b")).not.toBeNull();
    await deleteAllCheckpoints();
    expect(await getCheckpoint("b")).toBeNull();
  });
});
