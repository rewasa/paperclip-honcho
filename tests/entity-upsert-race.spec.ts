import { describe, expect, it } from "vitest";
import { upsertWorkspaceMapping } from "../src/entities.js";
import { createHonchoHarness } from "./helpers.js";

// Regression for PER-144: the Paperclip host implements entities.upsert as
// SELECT-then-INSERT without ON CONFLICT, so a concurrent insert of the same
// (entityType, externalId) makes the loser throw
// `Failed query: insert into "plugin_entities" ...`. That error used to
// propagate out of initialize-memory-for-company and surface as a 502 on the
// settings-page "Initialize Honcho memory" button. The plugin must retry once;
// the retry hits the host's UPDATE path and succeeds.
describe("entity upsert insert-race retry", () => {
  it("retries once when the host insert loses the unique-constraint race", async () => {
    const harness = createHonchoHarness();
    const realUpsert = harness.ctx.entities.upsert.bind(harness.ctx.entities);
    let calls = 0;
    harness.ctx.entities.upsert = (async (input: Parameters<typeof realUpsert>[0]) => {
      calls += 1;
      if (calls === 1) {
        throw new Error(
          'Failed query: insert into "plugin_entities" ("id", "plugin_id", "company_id", "entity_type", '
          + '"scope_kind", "scope_id", "external_id", "title", "status", "data", "created_at", "updated_at") '
          + "values (default, $1, default, $2, $3, $4, $5, $6, $7, $8, default, default)",
        );
      }
      return realUpsert(input);
    }) as typeof realUpsert;

    const record = await upsertWorkspaceMapping(harness.ctx, null, "co_1", "paperclip");

    expect(calls).toBe(2);
    expect(record).toMatchObject({
      entityType: "honcho-workspace-mapping",
      externalId: "paperclip:company:co_1",
    });
  });

  it("does not retry (and rethrows) on non-race errors", async () => {
    const harness = createHonchoHarness();
    const realUpsert = harness.ctx.entities.upsert.bind(harness.ctx.entities);
    let calls = 0;
    harness.ctx.entities.upsert = (async () => {
      calls += 1;
      throw new Error("invocation scope expired");
    }) as typeof realUpsert;

    await expect(upsertWorkspaceMapping(harness.ctx, null, "co_1", "paperclip"))
      .rejects.toThrow("invocation scope expired");
    expect(calls).toBe(1);
  });
});
