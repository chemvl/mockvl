import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { MockDetail, UsageReport, Workspace } from "@starter/schemas";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestUser } from "../helpers/app-user";
import { createMockvlServices } from "../helpers/mockvl";
import { prepareTestDatabase } from "../helpers/test-db";

await prepareTestDatabase();
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const userIds: string[] = [];
const petstore = await Bun.file(
  join(import.meta.dir, "../fixtures/schemas/petstore-3.0.yaml"),
).text();

const services = createMockvlServices(db);
const app = createApp({
  workspacesService: services.workspacesService,
  mocksService: services.mocksService,
  usageService: services.usageService,
  rateLimit: { global: { windowMs: 60_000, limit: 10_000 } },
});

afterAll(async () => {
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await pool.end({ timeout: 5 });
});

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

describe("GET /api/workspaces/{ws}/usage", () => {
  test("totals, zero-filled daily series, and per-mock rows for the range", async () => {
    const { user, accessToken } = await createTestUser(db);
    userIds.push(user.id);
    const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
    const [workspace] = (
      (await (await app.request("/api/workspaces", { headers })).json()) as {
        data: Workspace[];
      }
    ).data;
    const ws = workspace?.slug ?? "";
    const created = (await (
      await app.request(`/api/workspaces/${ws}/mocks`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Pets",
          slug: "pets",
          source: { type: "file", filename: "p.yaml", content: petstore },
        }),
      })
    ).json()) as { data: MockDetail };

    const thisHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    await db.insert(schema.mockUsageHourly).values([
      {
        mockId: created.data.id,
        hour: new Date(thisHour),
        requests: 5,
        clientErrors: 1,
        serverErrors: 0,
      },
      {
        mockId: created.data.id,
        hour: new Date(thisHour - 3 * DAY_MS),
        requests: 2,
        clientErrors: 0,
        serverErrors: 1,
      },
      {
        mockId: created.data.id,
        hour: new Date(thisHour - 10 * DAY_MS),
        requests: 100,
        clientErrors: 0,
        serverErrors: 0,
      },
    ]);

    const week = await app.request(`/api/workspaces/${ws}/usage?range=7d`, { headers });
    expect(week.status).toBe(200);
    const weekly = ((await week.json()) as { data: UsageReport }).data;
    expect(weekly.totals).toEqual({ requests: 7, clientErrors: 1, serverErrors: 1 });
    expect(weekly.daily).toHaveLength(7);
    expect(weekly.daily.at(-1)).toEqual({
      date: new Date(thisHour).toISOString().slice(0, 10),
      requests: 5,
    });
    expect(weekly.mocks).toEqual([
      { slug: "pets", name: "Pets", requests: 7, clientErrors: 1, serverErrors: 1 },
    ]);

    const month = (
      (await (await app.request(`/api/workspaces/${ws}/usage?range=30d`, { headers })).json()) as {
        data: UsageReport;
      }
    ).data;
    expect(month.totals.requests).toBe(107);
    expect(month.daily).toHaveLength(30);

    expect((await app.request(`/api/workspaces/${ws}/usage?range=1y`, { headers })).status).toBe(
      400,
    );
  });
});
