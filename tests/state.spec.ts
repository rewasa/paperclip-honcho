import { describe, expect, it } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { getCompanySyncStatus, patchCompanySyncStatus, sanitizeCompanyStatus } from "../src/state.js";

function createStateCtx(initial: unknown): { ctx: PluginContext; store: { value: unknown } } {
  const store = { value: initial };
  const ctx = {
    state: {
      get: async () => store.value,
      set: async (_key: unknown, value: unknown) => {
        store.value = value;
      },
      delete: async () => {
        store.value = null;
      },
    },
  } as unknown as PluginContext;
  return { ctx, store };
}

const POLLUTED = {
  connectionStatus: "connected",
  workspaceStatus: "created",
  peerStatus: "complete",
  initializationStatus: "complete",
  migrationStatus: "complete",
  promptContextStatus: "active",
  pendingFailureCount: 0,
  id: "4f0d7313-bdde-4627-b7c3-f48c922f272a",
  key: "final-reconciliation-after-retrim",
  body: "document body",
  title: "Final reconciliation after re-trim",
  issueId: "1075bddb-ce45-4989-88f6-3486e7720b96",
  latestRevisionId: "rev_1",
};

describe("company status state", () => {
  it("drops foreign keys when sanitizing", () => {
    const actual = sanitizeCompanyStatus(POLLUTED);
    expect(actual).not.toHaveProperty("body");
    expect(actual).not.toHaveProperty("key");
    expect(actual).not.toHaveProperty("issueId");
    expect(actual.initializationStatus).toBe("complete");
    expect(actual.lastError).toBeNull();
  });

  it("does not return foreign keys when reading a polluted row", async () => {
    const { ctx } = createStateCtx(POLLUTED);
    const actual = await getCompanySyncStatus(ctx, "co_1");
    expect(actual).not.toHaveProperty("body");
    expect(actual.migrationStatus).toBe("complete");
  });

  it("writes a clean row when patching a polluted row", async () => {
    const { ctx, store } = createStateCtx(POLLUTED);
    await patchCompanySyncStatus(ctx, "co_1", { lastSuccessfulSyncAt: "2026-10-15T12:00:00.000Z" });
    const stored = store.value as Record<string, unknown>;
    expect(stored).not.toHaveProperty("body");
    expect(stored).not.toHaveProperty("id");
    expect(stored.lastSuccessfulSyncAt).toBe("2026-10-15T12:00:00.000Z");
    expect(stored.initializationStatus).toBe("complete");
  });

  it("falls back to defaults for missing or non-object values", async () => {
    const { ctx } = createStateCtx(null);
    const actual = await getCompanySyncStatus(ctx, "co_1");
    expect(actual.initializationStatus).toBe("not_started");
  });
});
