import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { CustomEndpoint, MockDetail, MockOverride, Workspace } from "@starter/schemas";
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
import { importSchemaContent } from "@/modules/mocks/import/importer";
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

// The caller's personal workspace with blank custom mock "blank".
async function createBlankMock(token: string): Promise<Workspace> {
  const listed = (await (await call(token, "GET", "/workspaces")).json()) as { data: Workspace[] };
  const [workspace] = listed.data;
  if (!workspace) throw new Error("no workspace");
  const created = await call(token, "POST", `/workspaces/${workspace.slug}/mocks`, {
    name: "Blank",
    slug: "blank",
    source: { type: "custom" },
  });
  expect(created.status).toBe(201);
  return workspace;
}

async function dataOf<T>(res: Response): Promise<T> {
  return ((await res.json()) as { data: T }).data;
}

describe("Blank mocks", () => {
  test("start empty, answer 404, and refuse schema-only settings", async () => {
    const { accessToken: token } = await newUser();
    const ws = await createBlankMock(token);
    const mockPath = `/workspaces/${ws.slug}/mocks/blank`;

    const detail = await dataOf<MockDetail>(await call(token, "GET", mockPath));
    expect(detail).toMatchObject({
      sourceType: "custom",
      responseMode: "static",
      validateRequests: false,
      endpointCount: 0,
      operations: [],
    });
    expect(detail.liveVersion.number).toBe(1);

    expect((await root.request(`/m/${ws.slug}/blank/anything`)).status).toBe(404);

    for (const patch of [{ responseMode: "dynamic" }, { validateRequests: true }]) {
      expect(await errorOf(await call(token, "PATCH", mockPath, patch))).toMatchObject({
        status: 400,
        code: "CUSTOM_MOCK_SETTING",
      });
    }
    expect((await call(token, "PATCH", mockPath, { cors: false })).status).toBe(200);

    const replace = await call(token, "POST", `${mockPath}/versions`, {
      source: { type: "file", filename: "petstore.yaml", content: petstore },
    });
    expect(await errorOf(replace)).toMatchObject({ status: 409, code: "MOCK_NOT_IMPORTED" });
    expect(await errorOf(await call(token, "POST", `${mockPath}/resync`))).toMatchObject({
      status: 409,
      code: "MOCK_NOT_IMPORTED",
    });
  });

  test("schema download: generated document for custom mocks, the stored file for imports", async () => {
    const { accessToken: token } = await newUser();
    const ws = await createBlankMock(token);
    const blank = await dataOf<{ filename: string; content: string }>(
      await call(token, "GET", `/workspaces/${ws.slug}/mocks/blank/schema`),
    );
    expect(blank.filename).toBe("blank.openapi.json");
    expect(JSON.parse(blank.content)).toEqual({
      openapi: "3.1.0",
      info: { title: "Blank", version: "1.0.0" },
      paths: {},
    });

    await createPetsMock(token);
    const pets = await dataOf<{ filename: string; content: string }>(
      await call(token, "GET", `/workspaces/${ws.slug}/mocks/pets/schema`),
    );
    expect(pets).toEqual({ filename: "pets.yaml", content: petstore });
  });
});

type EndpointResult = { version: number; endpoint: CustomEndpoint };

const usersEndpoint = {
  kind: "http",
  method: "get",
  path: "/users/{id}",
  summary: "Get user",
  responses: [
    { status: 404, headers: {}, body: '{"error":"missing"}' },
    { status: 200, headers: { "X-Total-Count": "3" }, body: '{\n  "id": 7\n}' },
  ],
} as const;

describe("Custom endpoints", () => {
  test("defaults, edits, reset, versions, renames and conflicts", async () => {
    const { accessToken: token } = await newUser();
    const ws = await createBlankMock(token);
    const mockPath = `/workspaces/${ws.slug}/mocks/blank`;
    const item = (method: string, path: string, extra: Record<string, string> = {}) =>
      `${mockPath}/endpoints/item?${new URLSearchParams({ method, path, ...extra })}`;
    const hit = (rest: string, headers: Record<string, string> = {}) =>
      root.request(`/m/${ws.slug}/blank${rest}`, { headers });
    const KEY = { method: "get", path: "/users/{id}" };
    const edited = '{"id":7,"name":"Edited"}';
    const saveEdit = () =>
      call(token, "PUT", `${mockPath}/overrides`, { ...KEY, code: 200, body: edited });
    const resetEdit = () =>
      call(
        token,
        "DELETE",
        `${mockPath}/overrides?${new URLSearchParams({ ...KEY, code: "200" })}`,
      );
    const withDefault = (body: string, path = "/users/{id}") => ({
      ...usersEndpoint,
      path,
      responses: [usersEndpoint.responses[0], { ...usersEndpoint.responses[1], body }],
    });

    // First endpoint → v2; the 200 default (lowest 2xx) serves with its header.
    const created = await call(token, "POST", `${mockPath}/endpoints`, {
      baseVersion: 1,
      endpoint: usersEndpoint,
    });
    expect(created.status).toBe(201);
    const first = await dataOf<EndpointResult>(created);
    expect(first.version).toBe(2);
    expect(first.endpoint.responses[1]?.headers).toEqual({ "x-total-count": "3" });
    for (const rest of ["/users/1", "/users/2"]) {
      const res = await hit(rest);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 7 });
      expect(res.headers.get("x-total-count")).toBe("3");
    }
    const missing = await hit("/users/1", { prefer: "code=404" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "missing" });

    // An edit wins; reset serves the default again.
    expect((await saveEdit()).status).toBe(200);
    expect(await (await hit("/users/1")).text()).toBe(edited);
    expect((await resetEdit()).status).toBe(204);
    expect(await (await hit("/users/1")).json()).toEqual({ id: 7 });

    // New default while an edit is active: the edit still wins; reset lands on the new default.
    expect((await saveEdit()).status).toBe(200);
    const updated = await call(token, "PUT", item("get", "/users/{id}"), {
      baseVersion: 2,
      endpoint: withDefault('{"id":8}'),
    });
    expect((await dataOf<EndpointResult>(updated)).version).toBe(3);
    expect(await (await hit("/users/1")).text()).toBe(edited);
    expect((await resetEdit()).status).toBe(204);
    expect(await (await hit("/users/1")).json()).toEqual({ id: 8 });

    // Stale baseVersion inserts nothing; templates clash regardless of param names.
    const stale = await call(token, "POST", `${mockPath}/endpoints`, {
      baseVersion: 2,
      endpoint: { ...usersEndpoint, path: "/other" },
    });
    expect(await errorOf(stale)).toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect(
      (await dataOf<{ version: number }>(await call(token, "GET", `${mockPath}/endpoints`)))
        .version,
    ).toBe(3);
    const clash = await call(token, "POST", `${mockPath}/endpoints`, {
      baseVersion: 3,
      endpoint: { ...usersEndpoint, path: "/users/{userId}" },
    });
    expect(await errorOf(clash)).toEqual({
      status: 409,
      code: "ENDPOINT_EXISTS",
      message: "GET /users/{id} already exists.",
    });

    // Rename detaches the edit (dormant: listed, not served); renaming back serves it.
    expect((await saveEdit()).status).toBe(200);
    await call(token, "PUT", item("get", "/users/{id}"), {
      baseVersion: 3,
      endpoint: withDefault('{"id":8}', "/people/{id}"),
    });
    const renamed = await hit("/people/1");
    expect(await renamed.json()).toEqual({ id: 8 });
    expect(renamed.headers.get("x-mockvl-override")).toBeNull();
    const overrides = await dataOf<MockOverride[]>(
      await call(token, "GET", `${mockPath}/overrides`),
    );
    expect(overrides.map((o) => `${o.method} ${o.path} ${o.code}`)).toEqual([
      "get /users/{id} 200",
    ]);
    await call(token, "PUT", item("get", "/people/{id}"), {
      baseVersion: 4,
      endpoint: withDefault('{"id":8}'),
    });
    expect(await (await hit("/users/1")).text()).toBe(edited);

    // Delete → 404; restoring v5 brings the endpoint (and its edit) back.
    expect(
      (await call(token, "DELETE", item("get", "/users/{id}", { baseVersion: "5" }))).status,
    ).toBe(204);
    expect((await hit("/users/1")).status).toBe(404);
    expect((await call(token, "POST", `${mockPath}/versions/5/restore`)).status).toBe(200);
    expect(await (await hit("/users/1")).text()).toBe(edited);
    const listed = await dataOf<{ version: number; endpoints: unknown[] }>(
      await call(token, "GET", `${mockPath}/endpoints`),
    );
    expect(listed.version).toBe(7);
    expect(listed.endpoints).toHaveLength(1);

    // The downloaded schema re-imports to the live operations.
    const schemaFile = await dataOf<{ content: string }>(
      await call(token, "GET", `${mockPath}/schema`),
    );
    const detail = await dataOf<MockDetail>(await call(token, "GET", mockPath));
    const reimported = await importSchemaContent(schemaFile.content, "x");
    expect(reimported.operations).toEqual(detail.operations);
  });

  test("validation, no-body statuses, imported mocks and permissions", async () => {
    const owner = await newUser();
    const token = owner.accessToken;
    const ws = await createBlankMock(token);
    const mockPath = `/workspaces/${ws.slug}/mocks/blank`;
    const post = (endpoint: unknown, baseVersion = 1) =>
      call(token, "POST", `${mockPath}/endpoints`, { baseVersion, endpoint });
    const one = (status: number, body: string | null, headers: Record<string, string> = {}) => ({
      kind: "http",
      method: "delete",
      path: "/users/{id}",
      responses: [{ status, headers, body }],
    });

    expect(await errorOf(await post(one(204, "{}")))).toEqual({
      status: 400,
      code: "RESPONSE_STATUS_INVALID",
      message: "A 204 response can't have a body.",
    });
    expect(await errorOf(await post(one(200, "{}", { "Set-Cookie": "a=b" })))).toMatchObject({
      code: "RESPONSE_HEADER_INVALID",
    });
    expect(
      await errorOf(await post({ ...one(200, "{}"), path: "/files/{name}.json" })),
    ).toMatchObject({
      code: "ENDPOINT_PATH_INVALID",
    });
    expect(await errorOf(await post(one(200, "{nope")))).toMatchObject({
      code: "RESPONSE_INVALID_JSON",
    });
    const unknown = await call(
      token,
      "PUT",
      `${mockPath}/endpoints/item?${new URLSearchParams({ method: "get", path: "/nope" })}`,
      { baseVersion: 1, endpoint: one(200, "{}") },
    );
    expect(await errorOf(unknown)).toMatchObject({ status: 404, code: "ENDPOINT_NOT_FOUND" });

    // A 204 endpoint answers empty; an edit can't give it a body.
    expect((await post(one(204, null))).status).toBe(201);
    const res = await root.request(`/m/${ws.slug}/blank/users/1`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const override = await call(token, "PUT", `${mockPath}/overrides`, {
      method: "delete",
      path: "/users/{id}",
      code: 204,
      body: "{}",
    });
    expect(await errorOf(override)).toEqual({
      status: 400,
      code: "OVERRIDE_NO_BODY_STATUS",
      message: "A 204 response can't have a body.",
    });

    // Endpoint routes are custom-only.
    await createPetsMock(token);
    expect(
      await errorOf(await call(token, "GET", `/workspaces/${ws.slug}/mocks/pets/endpoints`)),
    ).toMatchObject({ status: 409, code: "MOCK_NOT_CUSTOM" });

    // Viewers read but can't write; non-members get 404.
    const viewer = await newUser();
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId: viewer.user.id, role: "viewer" });
    expect((await call(viewer.accessToken, "GET", `${mockPath}/endpoints`)).status).toBe(200);
    expect(
      await errorOf(
        await call(viewer.accessToken, "POST", `${mockPath}/endpoints`, {
          baseVersion: 2,
          endpoint: one(200, "{}"),
        }),
      ),
    ).toMatchObject({ status: 403, code: "FORBIDDEN" });
    const stranger = await newUser();
    expect((await call(stranger.accessToken, "GET", `${mockPath}/endpoints`)).status).toBe(404);
  });
});
