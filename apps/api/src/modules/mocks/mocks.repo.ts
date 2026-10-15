import type {
  CustomEndpoint,
  MockResponseMode,
  MockSourceType,
  MockStatus,
  MockVersionAction,
  OperationSummary,
  SchemaFormat,
  VersionDiff,
} from "@starter/schemas";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import {
  type MockVersionRow,
  mocks,
  mockUsageHourly,
  mockVersions,
  users,
  workspaces,
} from "@/db/schema";
import type { ListFilter, ListQuery } from "@/lib/pagination";
import { MAX_VERSIONS_PER_MOCK } from "./mocks.constants";

export interface UserRefRow {
  id: string;
  name: string | null;
  email: string;
}

export interface MockListRecord {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: MockStatus;
  endpointCount: number;
  requests24h: number;
  updatedAt: Date;
  updatedBy: UserRefRow | null;
}

export interface MockDetailRecord extends MockListRecord {
  responseMode: MockResponseMode;
  validateRequests: boolean;
  cors: boolean;
  sourceType: MockSourceType;
  sourceUrl: string | null;
  liveVersionId: string;
  createdAt: Date;
  createdBy: UserRefRow | null;
  liveVersion: {
    number: number;
    format: SchemaFormat;
    specVersion: string;
    sourceLabel: string;
    createdAt: Date;
    exampleCount: number;
    sizeBytes: number;
    contentSha256: string;
    operations: OperationSummary[];
  };
  versionCount: number;
}

export interface MockVersionRecord {
  id: string;
  number: number;
  action: MockVersionAction;
  sourceLabel: string;
  restoredFrom: number | null;
  diff: VersionDiff | null;
  endpointCount: number;
  createdAt: Date;
  createdBy: UserRefRow | null;
}

export interface MockRouteRecord {
  mockId: string;
  liveVersionId: string;
  status: MockStatus;
  responseMode: MockResponseMode;
  validateRequests: boolean;
  cors: boolean;
}

export interface VersionSourceRecord {
  content: string;
  format: SchemaFormat;
}

export interface NewMockInput {
  workspaceId: string;
  name: string;
  slug: string;
  responseMode: MockResponseMode;
  validateRequests: boolean;
  cors: boolean;
  sourceType: MockSourceType;
  sourceUrl: string | null;
  createdBy: string;
}

export interface NewVersionInput {
  action: MockVersionAction;
  sourceLabel: string;
  restoredFrom: number | null;
  format: SchemaFormat;
  specVersion: string;
  content: string;
  contentSha256: string;
  sizeBytes: number;
  endpointCount: number;
  exampleCount: number;
  operations: OperationSummary[];
  diff: VersionDiff | null;
  customEndpoints: CustomEndpoint[] | null;
  createdBy: string;
}

export interface MockPatch {
  name?: string;
  slug?: string;
  responseMode?: MockResponseMode;
  validateRequests?: boolean;
  cors?: boolean;
  status?: MockStatus;
  updatedBy: string;
}

export interface VersionMockPatch {
  sourceType?: MockSourceType;
  sourceUrl?: string | null;
  updatedBy: string;
}

export interface MockListOptions {
  query: ListQuery;
  // Free-text search over name and slug (ILIKE).
  q?: string;
  createdById?: string;
}

const creator = alias(users, "creator");
const updater = alias(users, "updater");

// Spec: sum over hours >= date_trunc('hour', now()) - 23h (≤ 1 min flush lag).
const requests24h = sql<number>`coalesce((
  select sum(${mockUsageHourly.requests}) from ${mockUsageHourly}
  where ${mockUsageHourly.mockId} = ${mocks.id}
    and ${mockUsageHourly.hour} >= date_trunc('hour', now()) - interval '23 hours'
), 0)::int`;

const versionCount = sql<number>`(
  select count(*) from ${mockVersions} where ${mockVersions.mockId} = ${mocks.id}
)::int`;

// List-contract columns (mirror of mockListFields; createdBy is resolved by
// the service into createdById). A miss means the two lists drifted.
const columns: Record<string, PgColumn> = {
  id: mocks.id,
  name: mocks.name,
  status: mocks.status,
  updatedAt: mocks.updatedAt,
  createdAt: mocks.createdAt,
};

function column(field: string): PgColumn {
  const col = columns[field];
  if (!col) throw new Error(`Column not exposed to the mocks list API: ${field}`);
  return col;
}

// ILIKE's %/_ are wildcards; search text is data, so escape them.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function driverValue(col: PgColumn, value: string): string | Date {
  return col.dataType === "date" ? new Date(value) : value;
}

function toCondition(filter: ListFilter): SQL {
  const col = column(filter.field);
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  const first = values[0] ?? "";
  switch (filter.op) {
    case "eq":
      return eq(col, driverValue(col, first));
    case "like":
      return ilike(col, `%${escapeLike(first)}%`);
    case "in":
      return inArray(
        col,
        values.map((value) => driverValue(col, value)),
      );
    case "gte":
      return gte(col, driverValue(col, first));
    case "lte":
      return lte(col, driverValue(col, first));
  }
}

export function userRef(
  id: string | null,
  name: string | null,
  email: string | null,
): UserRefRow | null {
  return id !== null && email !== null ? { id, name, email } : null;
}

export function createMocksRepo(db: Db) {
  const listSelection = {
    id: mocks.id,
    workspaceId: mocks.workspaceId,
    name: mocks.name,
    slug: mocks.slug,
    status: mocks.status,
    endpointCount: mockVersions.endpointCount,
    requests24h,
    updatedAt: mocks.updatedAt,
    updaterId: updater.id,
    updaterName: updater.name,
    updaterEmail: updater.email,
  };

  return {
    async list(
      workspaceId: string,
      options: MockListOptions,
    ): Promise<{ rows: MockListRecord[]; total: number }> {
      const conditions: SQL[] = [eq(mocks.workspaceId, workspaceId)];
      for (const filter of options.query.filters) conditions.push(toCondition(filter));
      if (options.createdById) conditions.push(eq(mocks.createdBy, options.createdById));
      if (options.q) {
        const pattern = `%${escapeLike(options.q)}%`;
        const search = or(ilike(mocks.name, pattern), ilike(mocks.slug, pattern));
        if (search) conditions.push(search);
      }
      const where = and(...conditions);
      const orderBy = [
        ...(options.query.sort.length > 0
          ? options.query.sort.map((s) =>
              s.dir === "desc" ? desc(column(s.field)) : asc(column(s.field)),
            )
          : [desc(mocks.updatedAt)]),
        asc(mocks.id),
      ];

      const rows = await db
        .select(listSelection)
        .from(mocks)
        .innerJoin(mockVersions, eq(mockVersions.id, mocks.liveVersionId))
        .leftJoin(updater, eq(updater.id, mocks.updatedBy))
        .where(where)
        .orderBy(...orderBy)
        .limit(options.query.pageSize)
        .offset((options.query.page - 1) * options.query.pageSize);

      const [counted] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(mocks)
        .where(where);

      return {
        rows: rows.map((row) => ({
          id: row.id,
          workspaceId: row.workspaceId,
          name: row.name,
          slug: row.slug,
          status: row.status,
          endpointCount: row.endpointCount,
          requests24h: row.requests24h,
          updatedAt: row.updatedAt,
          updatedBy: userRef(row.updaterId, row.updaterName, row.updaterEmail),
        })),
        total: counted?.total ?? 0,
      };
    },

    async countInWorkspace(workspaceId: string): Promise<number> {
      const [row] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(mocks)
        .where(eq(mocks.workspaceId, workspaceId));
      return row?.total ?? 0;
    },

    async slugExists(workspaceId: string, slug: string): Promise<boolean> {
      const [row] = await db
        .select({ id: mocks.id })
        .from(mocks)
        .where(and(eq(mocks.workspaceId, workspaceId), eq(mocks.slug, slug)))
        .limit(1);
      return row !== undefined;
    },

    async findDetail(workspaceId: string, slug: string): Promise<MockDetailRecord | undefined> {
      const [row] = await db
        .select({
          ...listSelection,
          responseMode: mocks.responseMode,
          validateRequests: mocks.validateRequests,
          cors: mocks.cors,
          sourceType: mocks.sourceType,
          sourceUrl: mocks.sourceUrl,
          liveVersionId: mockVersions.id,
          createdAt: mocks.createdAt,
          creatorId: creator.id,
          creatorName: creator.name,
          creatorEmail: creator.email,
          versionNumber: mockVersions.number,
          versionFormat: mockVersions.format,
          versionSpec: mockVersions.specVersion,
          versionLabel: mockVersions.sourceLabel,
          versionCreatedAt: mockVersions.createdAt,
          versionExamples: mockVersions.exampleCount,
          versionSize: mockVersions.sizeBytes,
          versionSha: mockVersions.contentSha256,
          versionOperations: mockVersions.operations,
          versionCount,
        })
        .from(mocks)
        .innerJoin(mockVersions, eq(mockVersions.id, mocks.liveVersionId))
        .leftJoin(updater, eq(updater.id, mocks.updatedBy))
        .leftJoin(creator, eq(creator.id, mocks.createdBy))
        .where(and(eq(mocks.workspaceId, workspaceId), eq(mocks.slug, slug)))
        .limit(1);
      if (!row) return undefined;
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        slug: row.slug,
        status: row.status,
        endpointCount: row.endpointCount,
        requests24h: row.requests24h,
        updatedAt: row.updatedAt,
        updatedBy: userRef(row.updaterId, row.updaterName, row.updaterEmail),
        responseMode: row.responseMode,
        validateRequests: row.validateRequests,
        cors: row.cors,
        sourceType: row.sourceType,
        sourceUrl: row.sourceUrl,
        liveVersionId: row.liveVersionId,
        createdAt: row.createdAt,
        createdBy: userRef(row.creatorId, row.creatorName, row.creatorEmail),
        liveVersion: {
          number: row.versionNumber,
          format: row.versionFormat,
          specVersion: row.versionSpec,
          sourceLabel: row.versionLabel,
          createdAt: row.versionCreatedAt,
          exampleCount: row.versionExamples,
          sizeBytes: row.versionSize,
          contentSha256: row.versionSha,
          operations: row.versionOperations,
        },
        versionCount: row.versionCount,
      };
    },

    // Mock runtime lookup by public URL parts.
    async findRoute(wsSlug: string, mockSlug: string): Promise<MockRouteRecord | null> {
      const [row] = await db
        .select({
          mockId: mocks.id,
          liveVersionId: mocks.liveVersionId,
          status: mocks.status,
          responseMode: mocks.responseMode,
          validateRequests: mocks.validateRequests,
          cors: mocks.cors,
        })
        .from(mocks)
        .innerJoin(workspaces, eq(workspaces.id, mocks.workspaceId))
        .where(
          and(
            eq(workspaces.slug, wsSlug),
            eq(mocks.slug, mockSlug),
            isNotNull(mocks.liveVersionId),
            isNull(workspaces.deletedAt),
          ),
        )
        .limit(1);
      if (!row?.liveVersionId) return null;
      return { ...row, liveVersionId: row.liveVersionId };
    },

    async findVersionSource(versionId: string): Promise<VersionSourceRecord | undefined> {
      const [row] = await db
        .select({ content: mockVersions.content, format: mockVersions.format })
        .from(mockVersions)
        .where(eq(mockVersions.id, versionId))
        .limit(1);
      return row;
    },

    // Custom mocks' endpoint list of one version; null for imported mocks.
    async findVersionEndpoints(versionId: string): Promise<CustomEndpoint[] | null> {
      const [row] = await db
        .select({ customEndpoints: mockVersions.customEndpoints })
        .from(mockVersions)
        .where(eq(mockVersions.id, versionId))
        .limit(1);
      return row?.customEndpoints ?? null;
    },

    async findVersionByNumber(mockId: string, number: number): Promise<MockVersionRow | undefined> {
      const [row] = await db
        .select()
        .from(mockVersions)
        .where(and(eq(mockVersions.mockId, mockId), eq(mockVersions.number, number)))
        .limit(1);
      return row;
    },

    async listVersions(mockId: string): Promise<MockVersionRecord[]> {
      const rows = await db
        .select({
          id: mockVersions.id,
          number: mockVersions.number,
          action: mockVersions.action,
          sourceLabel: mockVersions.sourceLabel,
          restoredFrom: mockVersions.restoredFrom,
          diff: mockVersions.diff,
          endpointCount: mockVersions.endpointCount,
          createdAt: mockVersions.createdAt,
          creatorId: creator.id,
          creatorName: creator.name,
          creatorEmail: creator.email,
        })
        .from(mockVersions)
        .leftJoin(creator, eq(creator.id, mockVersions.createdBy))
        .where(eq(mockVersions.mockId, mockId))
        .orderBy(desc(mockVersions.number));
      return rows.map(({ creatorId, creatorName, creatorEmail, ...row }) => ({
        ...row,
        createdBy: userRef(creatorId, creatorName, creatorEmail),
      }));
    },

    // Mock + v1 + live pointer in one transaction, so a mock is never visible
    // without a live version. Unique violations (slug) propagate.
    async createWithVersion(mock: NewMockInput, version: NewVersionInput): Promise<string> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(mocks)
          .values({ ...mock, updatedBy: mock.createdBy })
          .returning({ id: mocks.id });
        if (!row) throw new Error("mock insert returned no row");
        const [inserted] = await tx
          .insert(mockVersions)
          .values({ ...version, mockId: row.id, number: 1 })
          .returning({ id: mockVersions.id });
        if (!inserted) throw new Error("version insert returned no row");
        await tx.update(mocks).set({ liveVersionId: inserted.id }).where(eq(mocks.id, row.id));
        return row.id;
      });
    },

    // Next number under a row lock (concurrent writes to one mock never
    // collide), new version becomes live, then prune to the newest 20 — the
    // live version is always the newest, so it is never pruned. With
    // `expectedNumber` (custom-endpoint edits), returns null without writing
    // when the newest version isn't the one the editor loaded.
    async appendVersion(
      mockId: string,
      version: NewVersionInput,
      patch: VersionMockPatch,
      expectedNumber?: number,
    ): Promise<number | null> {
      return db.transaction(async (tx) => {
        await tx.select({ id: mocks.id }).from(mocks).where(eq(mocks.id, mockId)).for("update");
        const [last] = await tx
          .select({ number: max(mockVersions.number) })
          .from(mockVersions)
          .where(eq(mockVersions.mockId, mockId));
        const current = last?.number ?? 0;
        if (expectedNumber !== undefined && current !== expectedNumber) return null;
        const number = current + 1;
        const [inserted] = await tx
          .insert(mockVersions)
          .values({ ...version, mockId, number })
          .returning({ id: mockVersions.id });
        if (!inserted) throw new Error("version insert returned no row");
        await tx
          .update(mocks)
          .set({ ...patch, liveVersionId: inserted.id })
          .where(eq(mocks.id, mockId));
        await tx
          .delete(mockVersions)
          .where(
            and(
              eq(mockVersions.mockId, mockId),
              lte(mockVersions.number, number - MAX_VERSIONS_PER_MOCK),
            ),
          );
        return number;
      });
    },

    async update(mockId: string, patch: MockPatch): Promise<void> {
      await db.update(mocks).set(patch).where(eq(mocks.id, mockId));
    },

    async delete(mockId: string): Promise<void> {
      await db.delete(mocks).where(eq(mocks.id, mockId));
    },
  };
}

export type MocksRepo = ReturnType<typeof createMocksRepo>;
