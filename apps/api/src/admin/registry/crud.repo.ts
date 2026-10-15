import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import type { ListFilter, ListQuery } from "@/lib/pagination";
import type { ResourceRow } from "./registry";

// One generic data-access contract per registered resource. The service (and
// its tests) depend on this interface; createCrudRepo below is the Drizzle
// implementation the app wires in.
export interface CrudRepo {
  list(query: ListQuery): Promise<{ rows: ResourceRow[]; total: number }>;
  findById(id: string): Promise<ResourceRow | undefined>;
  insert(values: ResourceRow): Promise<ResourceRow>;
  update(id: string, values: ResourceRow): Promise<ResourceRow | undefined>;
  delete(id: string): Promise<ResourceRow | undefined>;
}

// ILIKE's %/_ are wildcards; filter values are data, so escape them (and the
// escape char itself) before wrapping in %...%.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

// Filter values arrive as strings (query-string data, pre-validated by
// parseListQuery). Timestamp columns are the one case Drizzle won't coerce
// itself — its driver mapping calls value.toISOString() — so convert here.
function driverValue(column: PgColumn, value: string): string | Date {
  return column.dataType === "date" ? new Date(value) : value;
}

function toCondition(filter: ListFilter, column: PgColumn) {
  switch (filter.op) {
    case "eq":
      return eq(column, driverValue(column, filter.value as string));
    case "like":
      return ilike(column, `%${escapeLike(filter.value as string)}%`);
    case "in":
      return inArray(
        column,
        (filter.value as string[]).map((entry) => driverValue(column, entry)),
      );
    case "gte":
      return gte(column, driverValue(column, filter.value as string));
    case "lte":
      return lte(column, driverValue(column, filter.value as string));
  }
}

// Generic Drizzle CRUD over any registered table. Field names arriving here
// were already allow-listed against the resource's fields metadata by
// parseListQuery, so the column lookups below cannot miss; the throw is a
// belt-and-braces guard against a caller bypassing the parser.
export function createCrudRepo(db: Db, table: PgTable): CrudRepo {
  const columns = getTableColumns(table) as Record<string, PgColumn>;

  function column(field: string): PgColumn {
    const col = columns[field];
    if (!col) throw new Error(`Unknown column: ${field}`);
    return col;
  }

  const idColumn = column("id");

  function buildWhere(filters: ListFilter[]) {
    if (filters.length === 0) return undefined;
    return and(...filters.map((filter) => toCondition(filter, column(filter.field))));
  }

  return {
    async list(query: ListQuery) {
      const where = buildWhere(query.filters);
      // Trailing id tiebreaker keeps pagination stable when the requested
      // sort has duplicate values (or no sort was requested at all).
      const orderBy = [
        ...query.sort.map((entry) =>
          entry.dir === "desc" ? desc(column(entry.field)) : asc(column(entry.field)),
        ),
        asc(idColumn),
      ];

      const rows = await db
        .select()
        .from(table)
        .where(where)
        .orderBy(...orderBy)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const [counted] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(table)
        .where(where);

      return { rows, total: counted?.total ?? 0 };
    },

    async findById(id: string) {
      const [row] = await db.select().from(table).where(eq(idColumn, id)).limit(1);
      return row;
    },

    async insert(values: ResourceRow) {
      // The def's Zod create schema validated `values`; the generic engine
      // can't know the table's insert type, hence the narrow cast.
      const [row] = await db
        .insert(table)
        .values(values as never)
        .returning();
      if (!row) throw new Error("insert returned no row");
      return row as ResourceRow;
    },

    async update(id: string, values: ResourceRow) {
      const [row] = await db
        .update(table)
        .set(values as never)
        .where(eq(idColumn, id))
        .returning();
      return row as ResourceRow | undefined;
    },

    async delete(id: string) {
      const [row] = await db.delete(table).where(eq(idColumn, id)).returning();
      return row as ResourceRow | undefined;
    },
  };
}
