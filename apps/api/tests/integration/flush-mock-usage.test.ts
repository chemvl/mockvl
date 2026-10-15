import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { createFlushMockUsageHandler } from "@/jobs/workers/flush-mock-usage";
import { closeRedis, createRedis } from "@/lib/redis";
import { createMocksRepo } from "@/modules/mocks/mocks.repo";
import { createUsageRepo } from "@/modules/usage/usage.repo";
import { createRedisUsageStore, createUsageCounter, usageKey } from "@/modules/usage/usage-counter";
import { createWorkspacesRepo } from "@/modules/workspaces/workspaces.repo";
import { createTestUser } from "../helpers/app-user";
import { prepareTestDatabase } from "../helpers/test-db";

// Real Postgres + Redis (docker compose up -d).
await prepareTestDatabase();
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
// Own client: redis.test.ts closes the shared singleton in its afterAll.
const client = createRedis(env.REDIS_URL);
const userIds: string[] = [];

const AT = new Date("2026-10-07T10:15:00.000Z");
const counter = createUsageCounter({ store: createRedisUsageStore(client), now: () => AT });
const flush = createFlushMockUsageHandler({ client, usageRepo: createUsageRepo(db) });

afterAll(async () => {
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await closeRedis(client);
  await pool.end({ timeout: 5 });
});

async function createMock(): Promise<string> {
  const { user } = await createTestUser(db);
  userIds.push(user.id);
  const workspace = await createWorkspacesRepo(db).insertWorkspace({
    slug: `flush-${crypto.randomUUID().slice(0, 8)}`,
    name: "Flush workspace",
    ownerId: user.id,
    domain: "example.com",
    personal: true,
  });
  return createMocksRepo(db).createWithVersion(
    {
      workspaceId: workspace.id,
      name: "Pets",
      slug: "pets",
      responseMode: "static",
      validateRequests: true,
      cors: true,
      sourceType: "file",
      sourceUrl: null,
      createdBy: user.id,
    },
    {
      action: "create",
      sourceLabel: "p.yaml",
      restoredFrom: null,
      format: "openapi3",
      specVersion: "3.0.3",
      content: "{}",
      contentSha256: "x",
      sizeBytes: 2,
      endpointCount: 1,
      exampleCount: 0,
      operations: [],
      diff: null,
      customEndpoints: null,
      createdBy: user.id,
    },
  );
}

async function rowsFor(mockId: string) {
  const rows = await db
    .select()
    .from(schema.mockUsageHourly)
    .where(eq(schema.mockUsageHourly.mockId, mockId));
  return rows.map((row) => ({
    hour: row.hour.toISOString(),
    requests: row.requests,
    clientErrors: row.clientErrors,
    serverErrors: row.serverErrors,
  }));
}

describe("flush-mock-usage", () => {
  test("moves counters into hourly rows; re-runs are idempotent; flushes accumulate", async () => {
    const mockId = await createMock();
    await counter.record(mockId, 200);
    await counter.record(mockId, 404);
    await counter.record(mockId, 503);

    await flush();
    const expected = {
      hour: "2026-10-07T10:00:00.000Z",
      requests: 3,
      clientErrors: 1,
      serverErrors: 1,
    };
    expect(await rowsFor(mockId)).toEqual([expected]);
    expect(await client.exists(usageKey(mockId, AT))).toBe(0);

    await flush();
    expect(await rowsFor(mockId)).toEqual([expected]);

    await counter.record(mockId, 200);
    await flush();
    expect(await rowsFor(mockId)).toEqual([{ ...expected, requests: 4 }]);
  });

  test("recovers an in-flight hash orphaned by a crashed flush", async () => {
    const mockId = await createMock();
    const orphan = `${usageKey(mockId, AT)}:flushing:${crypto.randomUUID()}`;
    await client.hset(orphan, "requests", "2", "server_errors", "1");
    await flush();
    expect(await rowsFor(mockId)).toEqual([
      { hour: "2026-10-07T10:00:00.000Z", requests: 2, clientErrors: 0, serverErrors: 1 },
    ]);
    expect(await client.exists(orphan)).toBe(0);
  });

  test("counters of deleted mocks are dropped without failing the run", async () => {
    const ghost = crypto.randomUUID();
    await counter.record(ghost, 200);
    expect(await flush()).toBeGreaterThanOrEqual(0);
    expect(await client.exists(usageKey(ghost, AT))).toBe(0);
  });
});
