import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { MockOverride, Workspace } from "@starter/schemas";
import type { IHttpOperation } from "@stoplight/types";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { type CachedFn, createCache } from "@/lib/cache";
import { closeRedis, createRedis } from "@/lib/redis";
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
import { createMockvlServices } from "../helpers/mockvl";
import { prepareTestDatabase } from "../helpers/test-db";

// Requires the compose Postgres and Redis (docker compose up -d).
await prepareTestDatabase();
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const redis = createRedis(String(process.env.REDIS_URL));
// Real cache (L1 + Redis): misses are cached, so save/reset must invalidate.
// Keys embed fresh mock ids, so runs never collide.
const cache = createCache({ client: redis });
const userIds: string[] = [];

const FIXTURES = join(import.meta.dir, "../fixtures/schemas");
const petstore = await Bun.file(join(FIXTURES, "petstore-3.0.yaml")).text();
const orders = await Bun.file(join(FIXTURES, "orders-3.1.json")).text();

const services = createMockvlServices(db, { invalidate: cache.invalidate });
// The route cache isn't under test: pass-through keeps PATCH / replace visible at once.
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
    overrides: createOverrideStore({ repo: services.overridesRepo, cached: cache.cached }),
    usage: createUsageCounter({ store: { async increment() {} } }),
    rateLimit: { windowMs: 60_000, limit: 10_000 },
    appOrigin: new URL(env.APP_URL).origin,
  }),
});

afterAll(async () => {
  // Personal workspaces cascade from their owner; mocks and overrides follow.
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await closeRedis(redis);
  await pool.end({ timeout: 5 });
});

async function newUser() {
  const created = await createTestUser(db);
  userIds.push(created.user.id);
  return created;
}

async function call(token: string, method: string, path: string, body?: unknown) {
  return root.request(`/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function errorOf(res: Response): Promise<{ status: number; code: string; message: string }> {
  const { error } = (await res.json()) as { error: { code: string; message: string } };
  return { status: res.status, code: error.code, message: error.message };
}

// The caller's personal workspace with mock "pets" (GET /pets/{id}: 200, 404).
async function createPetsMock(token: string): Promise<Workspace> {
  const listed = (await (await call(token, "GET", "/workspaces")).json()) as { data: Workspace[] };
  const [workspace] = listed.data;
  if (!workspace) throw new Error("no workspace");
  const created = await call(token, "POST", `/workspaces/${workspace.slug}/mocks`, {
    name: "Pets",
    slug: "pets",
    source: { type: "file", filename: "petstore.yaml", content: petstore },
  });
  expect(created.status).toBe(201);
  return workspace;
}

async function listOf(token: string, base: string): Promise<MockOverride[]> {
  const res = await call(token, "GET", base);
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: MockOverride[] }).data;
}

const keysOf = (list: MockOverride[]) =>
  list.map((item) => `${item.method} ${item.path} ${item.code}`);
const KEY = { method: "get", path: "/pets/{id}" } as const;
const resetQuery = (code: number) => new URLSearchParams({ ...KEY, code: String(code) }).toString();

describe("Mock response overrides — management API", () => {
  test("save upserts, the list carries no bodies, reset is idempotent", async () => {
    const owner = await newUser();
    const ws = await createPetsMock(owner.accessToken);
    const base = `/workspaces/${ws.slug}/mocks/pets/overrides`;

    expect(await listOf(owner.accessToken, base)).toEqual([]);
    const saved = await call(owner.accessToken, "PUT", base, {
      ...KEY,
      code: 200,
      body: '{\n  "id": 7\n}',
    });
    expect(saved.status).toBe(200);
    const data = ((await saved.json()) as { data: MockOverride }).data;
    expect(data).toMatchObject({ ...KEY, code: 200, updatedBy: { id: owner.user.id } });
    expect(data).not.toHaveProperty("body");

    // Same key again: still one row. Another code: a second row.
    expect(
      (await call(owner.accessToken, "PUT", base, { ...KEY, code: 200, body: "[]" })).status,
    ).toBe(200);
    expect(
      (await call(owner.accessToken, "PUT", base, { ...KEY, code: 404, body: "{}" })).status,
    ).toBe(200);
    const listed = await listOf(owner.accessToken, base);
    expect(keysOf(listed)).toEqual(["get /pets/{id} 200", "get /pets/{id} 404"]);
    expect(listed[0]).not.toHaveProperty("body");

    expect((await call(owner.accessToken, "DELETE", `${base}?${resetQuery(200)}`)).status).toBe(
      204,
    );
    expect((await call(owner.accessToken, "DELETE", `${base}?${resetQuery(200)}`)).status).toBe(
      204,
    );
    expect(keysOf(await listOf(owner.accessToken, base))).toEqual(["get /pets/{id} 404"]);
  });

  test("save checks run in order: target, size, JSON", async () => {
    const owner = await newUser();
    const ws = await createPetsMock(owner.accessToken);
    const base = `/workspaces/${ws.slug}/mocks/pets/overrides`;
    const put = (input: Record<string, unknown>) =>
      call(owner.accessToken, "PUT", base, { ...KEY, code: 200, body: "{}", ...input });
    const tooLarge = "x".repeat(256 * 1024 + 1);

    // Unknown target wins over a too-large, invalid body.
    expect(await errorOf(await put({ code: 500, body: tooLarge }))).toEqual({
      status: 400,
      code: "OVERRIDE_TARGET_UNKNOWN",
      message: "GET /pets/{id} has no 500 response in the live schema.",
    });
    // An existing operation without that code, and a method with no operation.
    expect((await errorOf(await put({ path: "/pets", code: 404 }))).message).toBe(
      "GET /pets has no 404 response in the live schema.",
    );
    expect((await errorOf(await put({ method: "post" }))).message).toBe(
      "POST /pets/{id} has no 200 response in the live schema.",
    );
    // Size wins over JSON validity.
    expect(await errorOf(await put({ body: tooLarge }))).toEqual({
      status: 400,
      code: "OVERRIDE_TOO_LARGE",
      message: "The response is larger than 256 KB.",
    });
    expect(await errorOf(await put({ body: '{"id":' }))).toEqual({
      status: 400,
      code: "OVERRIDE_INVALID_JSON",
      message: "The response isn't valid JSON.",
    });
    // Exactly 256 KiB passes; the limit counts bytes, not characters.
    expect((await put({ body: JSON.stringify("x".repeat(256 * 1024 - 2)) })).status).toBe(200);
    expect((await errorOf(await put({ body: JSON.stringify("é".repeat(128 * 1024)) }))).code).toBe(
      "OVERRIDE_TOO_LARGE",
    );
    expect(keysOf(await listOf(owner.accessToken, base))).toEqual(["get /pets/{id} 200"]);
  });

  test("viewers read but can't save or reset; non-members get 404", async () => {
    const owner = await newUser();
    const ws = await createPetsMock(owner.accessToken);
    const base = `/workspaces/${ws.slug}/mocks/pets/overrides`;
    const input = { ...KEY, code: 200, body: "{}" };

    const viewer = await newUser();
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId: viewer.user.id, role: "viewer" });
    expect((await call(viewer.accessToken, "GET", base)).status).toBe(200);
    expect(await errorOf(await call(viewer.accessToken, "PUT", base, input))).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect((await call(viewer.accessToken, "DELETE", `${base}?${resetQuery(200)}`)).status).toBe(
      403,
    );

    const stranger = await newUser();
    expect((await call(stranger.accessToken, "GET", base)).status).toBe(404);
    expect((await call(stranger.accessToken, "PUT", base, input)).status).toBe(404);
    expect((await call(stranger.accessToken, "DELETE", `${base}?${resetQuery(200)}`)).status).toBe(
      404,
    );
    expect(await listOf(owner.accessToken, base)).toEqual([]);
  });
});

describe("Mock response overrides — runtime (spec § Testing E2E 1–7)", () => {
  test("served for every path value and code, kept across modes and versions, reset to Prism", async () => {
    const owner = await newUser();
    const ws = await createPetsMock(owner.accessToken);
    const token = owner.accessToken;
    const mockPath = `/workspaces/${ws.slug}/mocks/pets`;
    const base = `${mockPath}/overrides`;
    const hit = (rest: string, headers: Record<string, string> = {}) =>
      root.request(`/m/${ws.slug}/pets${rest}`, { headers });
    const save = (code: number, body: string) => call(token, "PUT", base, { ...KEY, code, body });
    const custom = '{\n  "id": 7,\n  "name": "Custom"\n}';

    // 1. A 200 override answers /pets/1 and /pets/2 with the exact saved text.
    expect((await save(200, custom)).status).toBe(200);
    for (const rest of ["/pets/1", "/pets/2"]) {
      const res = await hit(rest);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(custom);
      expect(res.headers.get("x-mockvl-override")).toBe("1");
      expect(res.headers.get("content-type")).toBe("application/json");
    }

    // 2 + 5. code=404 is Prism's until a 404 is saved. That first lookup is
    // cached as a miss, so the save must invalidate it.
    const before = await hit("/pets/1", { prefer: "code=404" });
    expect(before.status).toBe(404);
    expect(await before.json()).toEqual({ message: "Pet not found" });
    expect(before.headers.get("x-mockvl-override")).toBeNull();
    expect((await save(404, '{"error":"gone"}')).status).toBe(200);
    const after = await hit("/pets/1", { prefer: "code=404" });
    expect(after.status).toBe(404);
    expect(await after.text()).toBe('{"error":"gone"}');
    expect(after.headers.get("x-mockvl-override")).toBe("1");

    // 3. A request failing validation keeps Prism's 422.
    const invalid = await hit("/pets/abc");
    expect(invalid.status).toBe(422);
    expect(invalid.headers.get("content-type")).toBe("application/problem+json");
    expect(invalid.headers.get("x-mockvl-override")).toBeNull();

    // 4. Dynamic mode: the override still wins.
    expect((await call(token, "PATCH", mockPath, { responseMode: "dynamic" })).status).toBe(200);
    expect(await (await hit("/pets/1")).text()).toBe(custom);
    expect((await call(token, "PATCH", mockPath, { responseMode: "static" })).status).toBe(200);

    // 6. A schema without the endpoint: dormant — not served, still listed.
    // Restoring v1 brings it back.
    const replaced = await call(token, "POST", `${mockPath}/versions`, {
      source: { type: "file", filename: "orders.json", content: orders },
    });
    expect(replaced.status).toBe(200);
    const gone = await hit("/pets/1");
    expect(gone.status).toBe(404);
    expect(gone.headers.get("x-mockvl-override")).toBeNull();
    expect(keysOf(await listOf(token, base))).toEqual(["get /pets/{id} 200", "get /pets/{id} 404"]);
    expect((await call(token, "POST", `${mockPath}/versions/1/restore`)).status).toBe(200);
    expect(await (await hit("/pets/1")).text()).toBe(custom);

    // 7. Reset: Prism's example again; the list drops the row.
    expect((await call(token, "DELETE", `${base}?${resetQuery(200)}`)).status).toBe(204);
    const reset = await hit("/pets/1");
    expect(await reset.json()).toEqual({ id: 1, name: "Rex" });
    expect(reset.headers.get("x-mockvl-override")).toBeNull();
    expect(keysOf(await listOf(token, base))).toEqual(["get /pets/{id} 404"]);
  });
});
