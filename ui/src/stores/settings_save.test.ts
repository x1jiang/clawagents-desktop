import { describe, expect, it } from "vitest";
import { awaitPendingSettingsSave, useSettingsSaveStatus } from "./settings_save";

describe("settings_save", () => {
  it("resolves immediately when no save is in flight", async () => {
    useSettingsSaveStatus.getState().setInFlight(null);
    await expect(awaitPendingSettingsSave()).resolves.toBeUndefined();
  });

  it("waits for the registered promise to settle", async () => {
    let resolved = false;
    let resolve: () => void = () => {};
    const p = new Promise<void>((r) => {
      resolve = () => {
        resolved = true;
        r();
      };
    });
    useSettingsSaveStatus.getState().setInFlight(p);

    const waiter = awaitPendingSettingsSave();
    expect(resolved).toBe(false);
    resolve();
    await waiter;
    expect(resolved).toBe(true);
  });

  it("does not reject when the in-flight save itself rejects", async () => {
    const p = Promise.reject(new Error("save failed"));
    useSettingsSaveStatus.getState().setInFlight(p);
    await expect(awaitPendingSettingsSave()).resolves.toBeUndefined();
  });
});
