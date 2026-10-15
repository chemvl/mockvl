import type { UsageRange, UsageReport, Workspace } from "@starter/schemas";
import type { UsageRepo } from "./usage.repo";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<UsageRange, number> = { "7d": 7, "30d": 30 };

export interface UsageServiceDeps {
  usageRepo: Pick<UsageRepo, "report">;
  now?: () => Date;
}

// A range is N whole UTC days ending today; days without traffic are 0 so
// the UI can chart the series as-is.
export function createUsageService(deps: UsageServiceDeps) {
  const { usageRepo, now = () => new Date() } = deps;
  return {
    async report(ws: Pick<Workspace, "id">, range: UsageRange): Promise<UsageReport> {
      const days = RANGE_DAYS[range];
      const today = now();
      const startMs =
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
        (days - 1) * DAY_MS;
      const rows = await usageRepo.report(ws.id, new Date(startMs));
      const byDate = new Map(rows.daily.map((row) => [row.date, row.requests]));
      const daily = Array.from({ length: days }, (_, index) => {
        const date = new Date(startMs + index * DAY_MS).toISOString().slice(0, 10);
        return { date, requests: byDate.get(date) ?? 0 };
      });
      const totals = rows.mocks.reduce(
        (sum, mock) => ({
          requests: sum.requests + mock.requests,
          clientErrors: sum.clientErrors + mock.clientErrors,
          serverErrors: sum.serverErrors + mock.serverErrors,
        }),
        { requests: 0, clientErrors: 0, serverErrors: 0 },
      );
      return { range, totals, daily, mocks: rows.mocks };
    },
  };
}

export type UsageService = ReturnType<typeof createUsageService>;
