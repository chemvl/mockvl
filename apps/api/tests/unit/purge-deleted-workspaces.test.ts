import "../setup";
import { describe, expect, test } from "bun:test";
import { createPurgeDeletedWorkspacesHandler } from "@/jobs/workers/purge-deleted-workspaces";

describe("purge-deleted-workspaces handler", () => {
  test("purges with a cutoff of now minus 30 days", async () => {
    const cutoffs: Date[] = [];
    const now = new Date("2026-10-07T03:17:00.000Z");
    const handler = createPurgeDeletedWorkspacesHandler({
      workspacesRepo: {
        purgeDeleted: async (cutoff) => {
          cutoffs.push(cutoff);
          return 2;
        },
      },
      now: () => now,
    });

    expect(await handler()).toBe(2);
    expect(cutoffs).toEqual([new Date("2026-09-07T03:17:00.000Z")]);
  });
});
