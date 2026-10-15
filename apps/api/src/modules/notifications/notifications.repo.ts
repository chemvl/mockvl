import type { NotificationStatus } from "@starter/schemas";
import { and, asc, desc, eq, gte, ilike, inArray, lte, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { notifications } from "@/db/schema";
import type { ListFilter, ListQuery } from "@/lib/pagination";

type NotificationRow = typeof notifications.$inferSelect;
type NewNotificationRow = typeof notifications.$inferInsert;

// The repo-side mirror of notificationFields (packages/schemas): only these
// columns are reachable from the admin list query contract.
const columns: Record<string, PgColumn> = {
  // id is implicitly filterable (eq/in) by parseListQuery.
  id: notifications.id,
  title: notifications.title,
  status: notifications.status,
  source: notifications.source,
  audience: notifications.audience,
  scheduledAt: notifications.scheduledAt,
  sentAt: notifications.sentAt,
  createdAt: notifications.createdAt,
};

function column(field: string): PgColumn {
  const col = columns[field];
  if (!col) throw new Error(`Column not exposed to the admin notifications API: ${field}`);
  return col;
}

// ILIKE's %/_ are wildcards; filter values are data, so escape them.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function driverValue(col: PgColumn, value: string): string | Date {
  return col.dataType === "date" ? new Date(value) : value;
}

function toCondition(filter: ListFilter) {
  const col = column(filter.field);
  switch (filter.op) {
    case "eq":
      return eq(col, driverValue(col, filter.value as string));
    case "like":
      return ilike(col, `%${escapeLike(filter.value as string)}%`);
    case "in":
      return inArray(
        col,
        (filter.value as string[]).map((v) => driverValue(col, v)),
      );
    case "gte":
      return gte(col, driverValue(col, filter.value as string));
    case "lte":
      return lte(col, driverValue(col, filter.value as string));
  }
}

export function createNotificationsRepo(db: Db) {
  return {
    async create(input: NewNotificationRow): Promise<NotificationRow> {
      const [row] = await db.insert(notifications).values(input).returning();
      if (!row) throw new Error("notification insert returned no row");
      return row;
    },

    async findById(id: string): Promise<NotificationRow | undefined> {
      const [row] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
      return row;
    },

    async list(query: ListQuery): Promise<{ rows: NotificationRow[]; total: number }> {
      const where: SQL | undefined = and(...query.filters.map((filter) => toCondition(filter)));
      // Trailing id tiebreaker keeps pagination stable; default newest-first.
      const orderBy = [
        ...(query.sort.length > 0
          ? query.sort.map((s) => (s.dir === "desc" ? desc(column(s.field)) : asc(column(s.field))))
          : [desc(notifications.createdAt)]),
        asc(notifications.id),
      ];

      const rows = await db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(...orderBy)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const [counted] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(notifications)
        .where(where);

      return { rows, total: counted?.total ?? 0 };
    },

    // Guarded transition: the UPDATE only lands while the current status is
    // one of `fromStatuses`, which doubles as the concurrency lock between the
    // admin actions and the send worker. Returns undefined when the guard
    // missed (row gone or status moved on).
    async updateWhereStatusIn(
      id: string,
      fromStatuses: NotificationStatus[],
      patch: Partial<NewNotificationRow>,
    ): Promise<NotificationRow | undefined> {
      const [row] = await db
        .update(notifications)
        .set(patch)
        .where(and(eq(notifications.id, id), inArray(notifications.status, fromStatuses)))
        .returning();
      return row;
    },

    // Incremental progress counters — the admin UI polls these mid-send.
    async addCounts(id: string, sent: number, failed: number): Promise<void> {
      if (sent === 0 && failed === 0) return;
      await db
        .update(notifications)
        .set({
          sentCount: sql`${notifications.sentCount} + ${sent}`,
          failedCount: sql`${notifications.failedCount} + ${failed}`,
        })
        .where(eq(notifications.id, id));
    },

    async deleteWhereStatusIn(
      id: string,
      fromStatuses: NotificationStatus[],
    ): Promise<NotificationRow | undefined> {
      const [row] = await db
        .delete(notifications)
        .where(and(eq(notifications.id, id), inArray(notifications.status, fromStatuses)))
        .returning();
      return row;
    },
  };
}

export type NotificationsRepo = ReturnType<typeof createNotificationsRepo>;
