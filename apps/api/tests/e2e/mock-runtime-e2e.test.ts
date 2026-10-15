import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { MockDetail, Workspace } from "@starter/schemas";
import type { IHttpOperation } from "@stoplight/types";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import type { CachedFn } from "@/lib/cache";
import { createMockApp } from "@/modules/mock-runtime/mock-app";
import {
  createOperationsCache,
  createVersionOperationsLoader,
} from "@/modules/mock-runtime/operations-cache";
import { createOverrideStore } from "@/modules/mock-runtime/override-store";
import { createRouteResolver } from "@/modules/mock-runtime/route-resolver";
import { createUsageCounter } from "@/modules/usage/usage-counter";
import { createRootApp } from "@/root";
import { createTestUser } from "../helpers/app-user";
import { createMockyardServices } from "../helpers/mockyard";
import { prepareTestDatabase } from "../helpers/test-db";

await prepareTestDatabase();
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const userIds: string[] = [];

const FIXTURES = join(import.meta.dir, "../fixtures/schemas");
const petstore = await Bun.file(join(FIXTURES, "petstore-3.0.yaml")).text();
const orders = await Bun.file(join(FIXTURES, "orders-3.1.json")).text();

const services = createMockyardServices(db);
const usageEvents: { key: string; fields: Record<string, number> }[] = [];
// No Redis: the route cache is a pass-through (every request hits the DB, so
// slug changes are visible immediately) and usage goes to an array.
const passthrough: CachedFn = (_key, _ttl, fn) => fn();
const root = createRootApp({
  api: createApp({
    workspacesService: services.workspacesService,
    mocksService: services.mocksService,
    rateLimit: { global: { windowMs: 60_000, limit: 10_000 } },
  }),
  mock: createMockApp({
    resolver: createRouteResolver({ mocksRepo: services.mocksRepo, cached: passthrough }),
    operations: createOperationsCache<IHttpOperation[]>({
      max: 20,
      load: createVersionOperationsLoader(services.mocksRepo),
    }),
    overrides: createOverrideStore({ repo: services.overridesRepo, cached: passthrough }),
    usage: createUsageCounter({
      store: {
        async increment(key, fields) {
          usageEvents.push({ key, fields });
        },
      },
    }),
    rateLimit: { windowMs: 60_000, limit: 10_000 },
    appOrigin: new URL(env.APP_URL).origin,
  }),
});

afterAll(async () => {
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await pool.end({ timeout: 5 });
});

describe("Mockyard end to end (spec § Testing E2E)", () => {
  test("create → call → Prefer → validation → CORS → pause → replace → restore → slug change → delete", async () => {
    const { user, accessToken } = await createTestUser(db);
    userIds.push(user.id);
    const api = (method: string, path: string, body?: unknown) =>
      root.request(`/api${path}`, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const json = async <T>(res: Response) => ((await res.json()) as { data: T }).data;

    // Workspace auto-create.
    const [workspace] = await json<Workspace[]>(await api("GET", "/workspaces"));
    if (!workspace) throw new Error("no workspace");
    const ws = workspace.slug;
    const mockUrl = (slug: string, rest: string) => `/m/${ws}/${slug}${rest}`;

    // Create from a file.
    const created = await api("POST", `/workspaces/${ws}/mocks`, {
      name: "Pets",
      slug: "pets",
      source: { type: "file", filename: "petstore.yaml", content: petstore },
    });
    expect(created.status).toBe(201);
    const detail = await json<MockDetail>(created);

    // 200 with the first example.
    const ok = await root.request(mockUrl("pets", "/pets/1"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ id: 1, name: "Rex" });
    expect(ok.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");

    // Prefer: code=404.
    const preferred = await root.request(mockUrl("pets", "/pets/1"), {
      headers: { prefer: "code=404" },
    });
    expect(preferred.status).toBe(404);
    expect(await preferred.json()).toEqual({ message: "Pet not found" });

    // Invalid param: 422 with validation on, 200 with it off.
    expect((await root.request(mockUrl("pets", "/pets/abc"))).status).toBe(422);
    expect(
      (await api("PATCH", `/workspaces/${ws}/mocks/pets`, { validateRequests: false })).status,
    ).toBe(200);
    expect((await root.request(mockUrl("pets", "/pets/abc"))).status).toBe(200);

    // CORS preflight.
    const preflight = await root.request(mockUrl("pets", "/pets"), {
      method: "OPTIONS",
      headers: { origin: "https://client.test", "access-control-request-method": "GET" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toBe("*");

    // Pause → 503, resume.
    await api("PATCH", `/workspaces/${ws}/mocks/pets`, { status: "paused" });
    const paused = await root.request(mockUrl("pets", "/pets/1"));
    expect(paused.status).toBe(503);
    expect(paused.headers.get("content-type")).toBe("application/problem+json");
    await api("PATCH", `/workspaces/${ws}/mocks/pets`, { status: "running" });

    // Replace → v2 with a diff; the old path is gone, the new one answers.
    const replaced = await json<MockDetail>(
      await api("POST", `/workspaces/${ws}/mocks/pets/versions`, {
        source: { type: "file", filename: "orders.json", content: orders },
      }),
    );
    expect(replaced.liveVersion.number).toBe(2);
    expect((await root.request(mockUrl("pets", "/pets/1"))).status).toBe(404);
    const order = await root.request(mockUrl("pets", "/orders"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(order.status).toBe(201);
    expect(await order.json()).toEqual({ id: "o-1" });

    // Restore v1 → v3.
    const restored = await json<MockDetail>(
      await api("POST", `/workspaces/${ws}/mocks/pets/versions/1/restore`),
    );
    expect(restored.liveVersion.number).toBe(3);
    expect((await root.request(mockUrl("pets", "/pets/1"))).status).toBe(200);

    // Slug change: the old URL 404s immediately.
    await api("PATCH", `/workspaces/${ws}/mocks/pets`, { slug: "animals" });
    const oldUrl = await root.request(mockUrl("pets", "/pets/1"));
    expect(oldUrl.status).toBe(404);
    expect(((await oldUrl.json()) as { title: string }).title).toBe("Mock not found");
    expect((await root.request(mockUrl("animals", "/pets/1"))).status).toBe(200);

    // Usage was counted for this mock, with 4xx/5xx buckets.
    const mine = usageEvents.filter((event) => event.key.includes(detail.id));
    expect(mine.length).toBeGreaterThan(5);
    expect(mine.some((event) => event.fields.client_errors === 1)).toBe(true);
    expect(mine.some((event) => event.fields.server_errors === 1)).toBe(true);

    // Delete → 404.
    expect((await api("DELETE", `/workspaces/${ws}/mocks/animals`)).status).toBe(204);
    expect((await root.request(mockUrl("animals", "/pets/1"))).status).toBe(404);
  });

  test("external $ref is rejected; the API keeps its JSON 404 under the root app", async () => {
    const { user, accessToken } = await createTestUser(db);
    userIds.push(user.id);
    const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
    const [workspace] = (
      (await (await root.request("/api/workspaces", { headers })).json()) as { data: Workspace[] }
    ).data;
    const res = await root.request(`/api/workspaces/${workspace?.slug}/mocks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Sneaky",
        slug: "sneaky",
        source: {
          type: "file",
          filename: "x.yaml",
          content:
            'openapi: 3.0.3\ninfo: {title: x, version: "1"}\npaths:\n  /x:\n    get:\n      responses:\n        "200":\n          description: ok\n          content:\n            application/json:\n              schema:\n                $ref: "/etc/passwd"\n',
        },
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SCHEMA_EXTERNAL_REF",
    );

    const apiNotFound = await root.request("/api/definitely-not-a-route");
    expect(apiNotFound.status).toBe(404);
    expect(((await apiNotFound.json()) as { error: { code: string } }).error.code).toBe(
      "NOT_FOUND",
    );
  });
});
