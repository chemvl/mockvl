import "../setup";
import { describe, expect, test } from "bun:test";
import type { UsageRepo } from "@/modules/usage/usage.repo";
import { createUsageService } from "@/modules/usage/usage.service";

const NOW = new Date("2026-10-07T12:34:00.000Z");

function fakeRepo() {
  const calls: { workspaceId: string; since: Date }[] = [];
  const repo: Pick<UsageRepo, "report"> = {
    async report(workspaceId, since) {
      calls.push({ workspaceId, since });
      return {
        daily: [
          { date: "2026-10-02", requests: 4 },
          { date: "2026-10-07", requests: 6 },
        ],
        mocks: [
          { slug: "pets", name: "Pets", requests: 8, clientErrors: 2, serverErrors: 1 },
          { slug: "orders", name: "Orders", requests: 2, clientErrors: 0, serverErrors: 0 },
        ],
      };
    },
  };
  return { repo, calls };
}

describe("usage report", () => {
  test("7d covers today and the 6 previous UTC days, zero-filled", async () => {
    const { repo, calls } = fakeRepo();
    const report = await createUsageService({ usageRepo: repo, now: () => NOW }).report(
      { id: "ws" },
      "7d",
    );
    expect(calls).toEqual([{ workspaceId: "ws", since: new Date("2026-10-01T00:00:00.000Z") }]);
    expect(report.range).toBe("7d");
    expect(report.daily.map((d) => d.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(report.daily.map((d) => d.requests)).toEqual([0, 4, 0, 0, 0, 0, 6]);
    expect(report.totals).toEqual({ requests: 10, clientErrors: 2, serverErrors: 1 });
    expect(report.mocks).toHaveLength(2);
  });

  test("30d starts 29 days before today", async () => {
    const { repo, calls } = fakeRepo();
    const report = await createUsageService({ usageRepo: repo, now: () => NOW }).report(
      { id: "ws" },
      "30d",
    );
    expect(calls[0]?.since).toEqual(new Date("2026-09-08T00:00:00.000Z"));
    expect(report.daily).toHaveLength(30);
  });
});
