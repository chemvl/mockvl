import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type {
  MockDetail,
  MockListItem,
  MockVersion,
  OperationRequest,
  ResyncResult,
  SlugAvailability,
  Workspace,
} from "@starter/schemas";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
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
const externalRef = await Bun.file(join(FIXTURES, "external-ref.yaml")).text();
const REMOTE_URL = "https://specs.example.test/orders.json";

const services = createMockyardServices(db, {
  fetchUrl: async (url) => {
    if (url !== REMOTE_URL) throw new Error(`unexpected fetch ${url}`);
    return orders;
  },
});
const app = createApp({
  workspacesService: services.workspacesService,
  mocksService: services.mocksService,
  rateLimit: { global: { windowMs: 60_000, limit: 10_000 } },
});

afterAll(async () => {
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await pool.end({ timeout: 5 });
});

async function signIn() {
  const created = await createTestUser(db);
  userIds.push(created.user.id);
  return created.accessToken;
}

function call(token: string, method: string, path: string, body?: unknown) {
  return app.request(`/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function data<T>(res: Response, status = 200): Promise<T> {
  expect(res.status).toBe(status);
  return ((await res.json()) as { data: T }).data;
}

async function errorCode(res: Response, status: number): Promise<string> {
  expect(res.status).toBe(status);
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("Mockyard management API", () => {
  test("full management flow", async () => {
    const token = await signIn();
    const [workspace] = await data<Workspace[]>(await call(token, "GET", "/workspaces"));
    if (!workspace) throw new Error("no personal workspace");
    const ws = `/workspaces/${workspace.slug}`;
    const fileSource = { type: "file", filename: "petstore.yaml", content: petstore };

    const inspection = await data<{ endpointCount: number; format: string }>(
      await call(token, "POST", `${ws}/schema/inspect`, { source: fileSource }),
    );
    expect(inspection).toMatchObject({ format: "openapi3", endpointCount: 2 });

    expect(
      await data<SlugAvailability>(
        await call(token, "GET", `${ws}/mocks/slug-availability?slug=pets`),
      ),
    ).toEqual({ slug: "pets", available: true, reason: null });
    expect(
      await data<SlugAvailability>(
        await call(token, "GET", `${ws}/mocks/slug-availability?slug=new`),
      ),
    ).toEqual({ slug: "new", available: false, reason: "reserved" });

    const created = await data<MockDetail>(
      await call(token, "POST", `${ws}/mocks`, { name: "Pets", slug: "pets", source: fileSource }),
      201,
    );
    expect(created.url).toBe(`${env.MOCK_PUBLIC_BASE_URL}/${workspace.slug}/pets`);
    expect(created).toMatchObject({
      status: "running",
      responseMode: "static",
      validateRequests: true,
      cors: true,
      endpointCount: 2,
      versionCount: 1,
      liveVersion: { number: 1, format: "openapi3", specVersion: "3.0.3" },
    });

    const operations = await data<OperationRequest[]>(
      await call(token, "GET", `${ws}/mocks/pets/operations`),
    );
    expect(operations.map((op) => `${op.method} ${op.path}`)).toEqual([
      "get /pets",
      "get /pets/{id}",
    ]);
    expect(operations[1]?.parameters.path).toEqual([
      { name: "id", required: true, description: null, schema: { type: "integer" }, examples: [] },
    ]);
    expect(operations[1]?.body).toBeNull();

    expect(
      await errorCode(
        await call(token, "POST", `${ws}/mocks`, { name: "Dup", slug: "pets", source: fileSource }),
        409,
      ),
    ).toBe("SLUG_TAKEN");
    expect(
      await errorCode(
        await call(token, "POST", `${ws}/mocks`, {
          name: "Sneaky",
          slug: "sneaky",
          source: { type: "file", filename: "e.yaml", content: externalRef },
        }),
        400,
      ),
    ).toBe("SCHEMA_EXTERNAL_REF");

    const listRes = await call(
      token,
      "GET",
      `${ws}/mocks?filter[createdBy][eq]=me&sort=updatedAt:desc`,
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { data: MockListItem[]; meta: { total: number } };
    expect(list.meta.total).toBe(1);
    expect(list.data[0]).toMatchObject({ slug: "pets", requests24h: 0 });
    expect((await data<MockListItem[]>(await call(token, "GET", `${ws}/mocks?q=zzz`))).length).toBe(
      0,
    );

    const paused = await data<MockDetail>(
      await call(token, "PATCH", `${ws}/mocks/pets`, { status: "paused", name: "Pets 2" }),
    );
    expect(paused).toMatchObject({ status: "paused", name: "Pets 2" });

    const replaced = await data<MockDetail>(
      await call(token, "POST", `${ws}/mocks/pets/versions`, {
        source: { type: "file", filename: "orders.json", content: orders },
      }),
    );
    expect(replaced.liveVersion.number).toBe(2);
    const versions = await data<MockVersion[]>(
      await call(token, "GET", `${ws}/mocks/pets/versions`),
    );
    expect(versions.map((v) => [v.number, v.action, v.live])).toEqual([
      [2, "replace", true],
      [1, "create", false],
    ]);
    expect(versions[0]?.diff).toEqual({
      endpointsAdded: 1,
      endpointsRemoved: 2,
      examplesChanged: 0,
    });

    expect(await errorCode(await call(token, "POST", `${ws}/mocks/pets/resync`), 409)).toBe(
      "NOT_URL_SOURCE",
    );

    const restored = await data<MockDetail>(
      await call(token, "POST", `${ws}/mocks/pets/versions/1/restore`),
    );
    expect(restored.liveVersion.number).toBe(3);
    expect(restored.endpointCount).toBe(2);

    await data<MockDetail>(
      await call(token, "POST", `${ws}/mocks`, {
        name: "Remote",
        slug: "remote",
        source: { type: "url", url: REMOTE_URL },
      }),
      201,
    );
    const resync = await data<ResyncResult>(await call(token, "POST", `${ws}/mocks/remote/resync`));
    expect(resync.changed).toBe(false);
    expect(resync.mock.liveVersion.number).toBe(1);

    expect((await call(token, "DELETE", `${ws}/mocks/pets`)).status).toBe(204);
    expect(await errorCode(await call(token, "GET", `${ws}/mocks/pets`), 404)).toBe("NOT_FOUND");
  });

  test("a 2 MiB schema body is accepted on schema routes", async () => {
    const token = await signIn();
    const [workspace] = await data<Workspace[]>(await call(token, "GET", "/workspaces"));
    const padded = `${petstore}\n# ${"x".repeat(2 * 1024 * 1024)}\n`;
    const res = await call(token, "POST", `/workspaces/${workspace?.slug}/schema/inspect`, {
      source: { type: "file", filename: "big.yaml", content: padded },
    });
    expect(res.status).toBe(200);
  });

  test("non-members get 404 for another workspace", async () => {
    const owner = await signIn();
    const [workspace] = await data<Workspace[]>(await call(owner, "GET", "/workspaces"));
    const stranger = await signIn();
    expect(
      await errorCode(await call(stranger, "GET", `/workspaces/${workspace?.slug}/mocks`), 404),
    ).toBe("NOT_FOUND");
  });
});
