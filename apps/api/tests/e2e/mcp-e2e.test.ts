import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type CallToolResult,
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type {
  CreatedPersonalAccessToken,
  MockOverride,
  PersonalAccessToken,
  PersonalAccessTokenScope,
  Workspace,
} from "@starter/schemas";
import type { IHttpOperation } from "@stoplight/types";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { type CachedFn, createCache } from "@/lib/cache";
import { closeRedis, createRedis } from "@/lib/redis";
import { hashOpaqueToken } from "@/modules/auth/auth.tokens";
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
// Real cache (L1 + Redis): override save/reset must invalidate the runtime.
const cache = createCache({ client: redis });
const userIds: string[] = [];

const FIXTURES = join(import.meta.dir, "../fixtures/schemas");
const petstore = await Bun.file(join(FIXTURES, "petstore-3.0.yaml")).text();

const services = createMockvlServices(db, { invalidate: cache.invalidate });
const passthrough: CachedFn = (_key, _ttl, fn) => fn();
const root = createRootApp({
  api: createApp({
    workspacesService: services.workspacesService,
    mocksService: services.mocksService,
    personalAccessTokensService: services.personalAccessTokensService,
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
  // Workspaces, mocks, and tokens cascade from their users.
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await closeRedis(redis);
  await pool.end({ timeout: 5 });
});

const PAT_SHAPE = /^mky_pat_[A-Za-z0-9_-]{43}$/;
const READ_TOOLS = ["list_mock_endpoints", "list_mocks"];
const ALL_TOOLS = [
  "list_mock_endpoints",
  "list_mocks",
  "reset_mock_response",
  "update_mock_response",
];

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

async function dataOf<T>(res: Response): Promise<T> {
  const body: { data: T } = await res.json();
  return body.data;
}

async function errorOf(res: Response): Promise<{ status: number; code: string; message: string }> {
  const body: { error: { code: string; message: string } } = await res.json();
  return { status: res.status, code: body.error.code, message: body.error.message };
}

async function personalWorkspace(token: string): Promise<Workspace> {
  const [workspace] = await dataOf<Workspace[]>(await call(token, "GET", "/workspaces"));
  if (!workspace) throw new Error("no workspace");
  return workspace;
}

// The caller's personal workspace with mock "pets" (GET /pets/{id}: 200, 404).
async function createPetsMock(token: string): Promise<Workspace> {
  const workspace = await personalWorkspace(token);
  const created = await call(token, "POST", `/workspaces/${workspace.slug}/mocks`, {
    name: "Pets",
    slug: "pets",
    source: { type: "file", filename: "petstore.yaml", content: petstore },
  });
  expect(created.status).toBe(201);
  return workspace;
}

async function createPat(
  jwt: string,
  ws: Workspace,
  scope: PersonalAccessTokenScope,
  days = 30,
): Promise<CreatedPersonalAccessToken> {
  const res = await call(jwt, "POST", `/workspaces/${ws.slug}/personal-access-tokens`, {
    name: `e2e ${scope}`,
    scope,
    expiresInDays: days,
  });
  expect(res.status).toBe(201);
  return dataOf<CreatedPersonalAccessToken>(res);
}

async function withMcp<T>(plaintextToken: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/api/mcp"), {
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${plaintextToken}`);
      return root.fetch(new Request(url, { ...init, headers }));
    },
  });
  const client = new Client(
    { name: "e2e", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function toolNames(client: Client): Promise<string[]> {
  return (await client.listTools()).tools.map((tool) => tool.name).sort();
}

// Plain tools/list without a client, for status-code assertions.
async function rawMcp(headers: Record<string, string>): Promise<Response> {
  return root.request("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function textOf(result: CallToolResult): string {
  const [first] = result.content;
  return first?.type === "text" ? first.text : "";
}

const petEndpoint = (fields: Record<string, unknown>) => ({
  endpoints: expect.arrayContaining([
    expect.objectContaining({ method: "get", path: "/pets/{id}", ...fields }),
  ]),
});

describe("personal access token REST routes", () => {
  test("create returns the plaintext once; only its hash is stored", async () => {
    const { accessToken } = await newUser();
    const ws = await personalWorkspace(accessToken);
    const created = await createPat(accessToken, ws, "mocks:read");
    expect(created.plaintextToken).toMatch(PAT_SHAPE);
    expect(created.mcpUrl.endsWith("/api/mcp")).toBe(true);

    const listed = await call(accessToken, "GET", `/workspaces/${ws.slug}/personal-access-tokens`);
    expect(listed.status).toBe(200);
    const tokens = await dataOf<PersonalAccessToken[]>(listed);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      id: created.token.id,
      scope: "mocks:read",
      tokenHint: `mky_pat_…${created.plaintextToken.slice(-4)}`,
    });
    expect(tokens[0]).not.toHaveProperty("plaintextToken");

    const [row] = await db
      .select()
      .from(schema.personalAccessTokens)
      .where(eq(schema.personalAccessTokens.id, created.token.id));
    expect(row?.tokenHash).toBe(hashOpaqueToken(created.plaintextToken));
    expect(Object.values(row ?? {})).not.toContain(created.plaintextToken);
  });

  test("viewers get read tokens only; others' tokens can't be revoked", async () => {
    const owner = await newUser();
    const viewer = await newUser();
    const ws = await personalWorkspace(owner.accessToken);
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId: viewer.user.id, role: "viewer" });
    const base = `/workspaces/${ws.slug}/personal-access-tokens`;

    const write = await call(viewer.accessToken, "POST", base, {
      name: "w",
      scope: "mocks:write",
      expiresInDays: 7,
    });
    expect(await errorOf(write)).toMatchObject({ status: 403, code: "FORBIDDEN" });
    const read = await call(viewer.accessToken, "POST", base, {
      name: "r",
      scope: "mocks:read",
      expiresInDays: 7,
    });
    expect(read.status).toBe(201);

    const ownerToken = await createPat(owner.accessToken, ws, "mocks:write");
    const revoke = await call(viewer.accessToken, "DELETE", `${base}/${ownerToken.token.id}`);
    expect(await errorOf(revoke)).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect((await rawMcp(bearer(ownerToken.plaintextToken))).status).toBe(200);
  });

  test("the 21st active token is refused", async () => {
    const { accessToken } = await newUser();
    const ws = await personalWorkspace(accessToken);
    for (let i = 0; i < 20; i++) await createPat(accessToken, ws, "mocks:read", 7);
    const res = await call(accessToken, "POST", `/workspaces/${ws.slug}/personal-access-tokens`, {
      name: "one too many",
      scope: "mocks:read",
      expiresInDays: 7,
    });
    expect(await errorOf(res)).toMatchObject({ status: 409, code: "TOKEN_LIMIT_REACHED" });
  });
});

describe("MCP auth gate", () => {
  test("only a personal access token, from a non-browser client, gets in", async () => {
    const { accessToken } = await newUser();
    const ws = await personalWorkspace(accessToken);
    const { plaintextToken } = await createPat(accessToken, ws, "mocks:read");

    const missing = await rawMcp({});
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")?.startsWith("Bearer")).toBe(true);

    const random = `mky_pat_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
    expect(random).toMatch(PAT_SHAPE);
    expect((await rawMcp(bearer(random))).status).toBe(401);
    expect((await rawMcp(bearer(accessToken))).status).toBe(401);
    expect((await call(plaintextToken, "GET", "/workspaces")).status).toBe(401);

    const browser = await rawMcp({ ...bearer(plaintextToken), origin: "https://evil.example" });
    expect(browser.status).toBe(403);
    expect((await rawMcp(bearer(plaintextToken))).status).toBe(200);
  });
});

describe("MCP tools", () => {
  test("a read token lists mocks and endpoints but can't change responses", async () => {
    const { accessToken } = await newUser();
    const ws = await createPetsMock(accessToken);
    const { plaintextToken } = await createPat(accessToken, ws, "mocks:read");

    await withMcp(plaintextToken, async (client) => {
      expect(await toolNames(client)).toEqual(READ_TOOLS);

      const listed = await client.callTool({ name: "list_mocks", arguments: {} });
      expect(listed.isError).toBeFalsy();
      expect(listed.structuredContent).toMatchObject({
        workspace: ws.slug,
        total: 1,
        mocks: [{ slug: "pets", name: "Pets" }],
      });

      const endpoints = await client.callTool({
        name: "list_mock_endpoints",
        arguments: { mock: "pets" },
      });
      expect(endpoints.structuredContent).toMatchObject({
        mock: "pets",
        ...petEndpoint({ statusCodes: [200, 404], customResponseCodes: [] }),
      });

      let refused = false;
      try {
        const result = await client.callTool({
          name: "update_mock_response",
          arguments: {
            mock: "pets",
            method: "get",
            path: "/pets/{id}",
            statusCode: 200,
            body: "{}",
          },
        });
        refused = result.isError === true;
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
    });

    const overrides = await call(accessToken, "GET", `/workspaces/${ws.slug}/mocks/pets/overrides`);
    expect(await dataOf<MockOverride[]>(overrides)).toEqual([]);
  });

  test("a write token updates and resets a response the mock serves", async () => {
    const { accessToken } = await newUser();
    const ws = await createPetsMock(accessToken);
    const { plaintextToken } = await createPat(accessToken, ws, "mocks:write");
    const key = { mock: "pets", method: "get", path: "/pets/{id}", statusCode: 200 };

    await withMcp(plaintextToken, async (client) => {
      expect(await toolNames(client)).toEqual(ALL_TOOLS);

      const saved = await client.callTool({
        name: "update_mock_response",
        arguments: { ...key, body: '{"id":7}' },
      });
      expect(saved.isError).toBeFalsy();
      expect(saved.structuredContent).toMatchObject(key);
      const hit = await root.request(`/m/${ws.slug}/pets/pets/1`);
      expect(await hit.text()).toBe('{"id":7}');
      expect(hit.headers.get("x-mockvl-override")).toBe("1");

      const endpoints = await client.callTool({
        name: "list_mock_endpoints",
        arguments: { mock: "pets" },
      });
      expect(endpoints.structuredContent).toMatchObject(
        petEndpoint({ customResponseCodes: [200] }),
      );

      const failures: [Record<string, unknown>, string][] = [
        [{ ...key, body: "{not json" }, "OVERRIDE_INVALID_JSON:"],
        [{ ...key, statusCode: 500, body: "{}" }, "OVERRIDE_TARGET_UNKNOWN:"],
        [{ ...key, mock: "nope", body: "{}" }, "NOT_FOUND:"],
      ];
      for (const [args, prefix] of failures) {
        const result = await client.callTool({ name: "update_mock_response", arguments: args });
        expect(result.isError).toBe(true);
        expect(textOf(result).startsWith(prefix)).toBe(true);
      }

      const reset = await client.callTool({ name: "reset_mock_response", arguments: key });
      expect(reset.structuredContent).toMatchObject({ ...key, reset: true });
      const after = await root.request(`/m/${ws.slug}/pets/pets/1`);
      expect(after.headers.get("x-mockvl-override")).toBeNull();
    });
  });

  test("a token only sees its own workspace", async () => {
    const first = await newUser();
    const second = await newUser();
    const ws = await createPetsMock(first.accessToken);
    await createPetsMock(second.accessToken);
    const { plaintextToken } = await createPat(first.accessToken, ws, "mocks:read");

    await withMcp(plaintextToken, async (client) => {
      const listed = await client.callTool({ name: "list_mocks", arguments: {} });
      expect(listed.structuredContent).toMatchObject({
        workspace: ws.slug,
        total: 1,
        mocks: [{ slug: "pets", url: expect.stringContaining(`/m/${ws.slug}/pets`) }],
      });
    });
  });
});

describe("token lifecycle", () => {
  test("revoked and expired tokens stop working", async () => {
    const { accessToken } = await newUser();
    const ws = await personalWorkspace(accessToken);
    const revoked = await createPat(accessToken, ws, "mocks:read");
    const expired = await createPat(accessToken, ws, "mocks:read");
    expect((await rawMcp(bearer(revoked.plaintextToken))).status).toBe(200);

    const res = await call(
      accessToken,
      "DELETE",
      `/workspaces/${ws.slug}/personal-access-tokens/${revoked.token.id}`,
    );
    expect(res.status).toBe(204);
    expect((await rawMcp(bearer(revoked.plaintextToken))).status).toBe(401);

    await db
      .update(schema.personalAccessTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.personalAccessTokens.id, expired.token.id));
    expect((await rawMcp(bearer(expired.plaintextToken))).status).toBe(401);
  });

  test("a demoted member's write token loses the write tools", async () => {
    const owner = await newUser();
    const editor = await newUser();
    const ws = await createPetsMock(owner.accessToken);
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId: editor.user.id, role: "editor" });
    const { plaintextToken } = await createPat(editor.accessToken, ws, "mocks:write");
    await withMcp(plaintextToken, async (client) => {
      expect(await toolNames(client)).toEqual(ALL_TOOLS);
    });

    await db
      .update(schema.workspaceMembers)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, ws.id),
          eq(schema.workspaceMembers.userId, editor.user.id),
        ),
      );
    await withMcp(plaintextToken, async (client) => {
      expect(await toolNames(client)).toEqual(READ_TOOLS);
      let refused = false;
      try {
        const result = await client.callTool({
          name: "update_mock_response",
          arguments: {
            mock: "pets",
            method: "get",
            path: "/pets/{id}",
            statusCode: 200,
            body: "{}",
          },
        });
        refused = result.isError === true;
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
    });
  });

  test("removing and re-adding a member doesn't revive old tokens", async () => {
    const owner = await newUser();
    const member = await newUser();
    const ws = await personalWorkspace(owner.accessToken);
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId: member.user.id, role: "editor" });
    const { plaintextToken } = await createPat(member.accessToken, ws, "mocks:read");
    expect((await rawMcp(bearer(plaintextToken))).status).toBe(200);

    const membership = and(
      eq(schema.workspaceMembers.workspaceId, ws.id),
      eq(schema.workspaceMembers.userId, member.user.id),
    );
    await db.delete(schema.workspaceMembers).where(membership);
    expect((await rawMcp(bearer(plaintextToken))).status).toBe(401);
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId: member.user.id, role: "editor" });
    expect((await rawMcp(bearer(plaintextToken))).status).toBe(401);
  });
});
