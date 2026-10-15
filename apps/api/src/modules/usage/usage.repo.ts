import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mocks, mockUsageHourly } from "@/db/schema";
import { isForeignKeyViolation } from "@/lib/db-errors";

export interface HourlyUsage {
  mockId: string;
  hour: Date;
  requests: number;
  clientErrors: number;
  serverErrors: number;
}

export interface UsageReportRows {
  daily: { date: string; requests: number }[];
  mocks: {
    slug: string;
    name: string;
    requests: number;
    clientErrors: number;
    serverErrors: number;
  }[];
}

export function createUsageRepo(db: Db) {
  return {
    // Upsert-add: several flushes of one hour accumulate. Returns false when
    // the mock was deleted after the requests were counted.
    async addHourly(row: HourlyUsage): Promise<boolean> {
      try {
        await db
          .insert(mockUsageHourly)
          .values(row)
          .onConflictDoUpdate({
            target: [mockUsageHourly.mockId, mockUsageHourly.hour],
            set: {
              requests: sql`${mockUsageHourly.requests} + excluded.requests`,
              clientErrors: sql`${mockUsageHourly.clientErrors} + excluded.client_errors`,
              serverErrors: sql`${mockUsageHourly.serverErrors} + excluded.server_errors`,
            },
          });
        return true;
      } catch (error) {
        if (isForeignKeyViolation(error)) return false;
        throw error;
      }
    },

    async report(workspaceId: string, since: Date): Promise<UsageReportRows> {
      const day = sql<string>`to_char(${mockUsageHourly.hour} at time zone 'UTC', 'YYYY-MM-DD')`;
      const daily = await db
        .select({ date: day, requests: sql<number>`sum(${mockUsageHourly.requests})::int` })
        .from(mockUsageHourly)
        .innerJoin(mocks, eq(mocks.id, mockUsageHourly.mockId))
        .where(and(eq(mocks.workspaceId, workspaceId), gte(mockUsageHourly.hour, since)))
        .groupBy(day)
        .orderBy(day);

      const requests = sql<number>`coalesce(sum(${mockUsageHourly.requests}), 0)::int`;
      const perMock = await db
        .select({
          slug: mocks.slug,
          name: mocks.name,
          requests,
          clientErrors: sql<number>`coalesce(sum(${mockUsageHourly.clientErrors}), 0)::int`,
          serverErrors: sql<number>`coalesce(sum(${mockUsageHourly.serverErrors}), 0)::int`,
        })
        .from(mocks)
        .leftJoin(
          mockUsageHourly,
          and(eq(mockUsageHourly.mockId, mocks.id), gte(mockUsageHourly.hour, since)),
        )
        .where(eq(mocks.workspaceId, workspaceId))
        .groupBy(mocks.id)
        .orderBy(desc(requests), asc(mocks.name));

      return { daily, mocks: perMock };
    },
  };
}

export type UsageRepo = ReturnType<typeof createUsageRepo>;
