import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { z } from "@hono/zod-openapi";
import { envelope, type Workspace, WorkspaceSchema } from "@starter/schemas";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { createUserRepo } from "@/modules/users/users.repo";
import { NO_PERMISSION } from "@/modules/workspaces/workspaces.errors";
import { createWorkspacesRepo } from "@/modules/workspaces/workspaces.repo";
import { createWorkspacesService } from "@/modules/workspaces/workspaces.service";
import { createTestUser } from "../helpers/app-user";
import { createMockvlServices } from "../helpers/mockvl";
import { prepareTestDatabase } from "../helpers/test-db";

await prepareTestDatabase();
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const userIds: string[] = [];

function buildApp(allowedHd?: string) {
  return createApp({
    workspacesService: createWorkspacesService({
      workspacesRepo: createWorkspacesRepo(db),
      userRepo: createUserRepo(db),
      invalidate: async () => {},
      ...(allowedHd === undefined ? {} : { allowedHd }),
    }),
    mocksService: createMockvlServices(db).mocksService,
    rateLimit: { global: { windowMs: 60_000, limit: 10_000 } },
  });
}

const app = buildApp();

afterAll(async () => {
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await pool.end({ timeout: 5 });
});

async function newUser(email?: string) {
  const created = await createTestUser(db, email === undefined ? {} : { email });
  userIds.push(created.user.id);
  return created;
}

function listWorkspaces(token: string | undefined, target = app) {
  return target.request("/api/workspaces", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function callScoped(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  return app.request(`/api/workspaces/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// A workspace owned by someone else, with `memberId` added as `role`.
async function sharedWorkspace(memberId: string, role: "admin" | "editor" | "viewer") {
  const { user: owner } = await newUser();
  const workspace = await createWorkspacesRepo(db).insertWorkspace({
    slug: `team-${crypto.randomUUID().slice(0, 8)}`,
    name: "Team",
    ownerId: owner.id,
    domain: "example.com",
    personal: false,
  });
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: workspace.id, userId: memberId, role });
  return workspace;
}

const WorkspaceListSchema = envelope(z.array(WorkspaceSchema));

async function readWorkspaces(res: Response): Promise<Workspace[]> {
  return WorkspaceListSchema.parse(await res.json()).data;
}

describe("GET /api/workspaces", () => {
  test("auto-creates one personal workspace, idempotently", async () => {
    const local = `ws-e2e-${crypto.randomUUID().slice(0, 8)}`;
    const { user, accessToken } = await newUser(`${local}@example.com`);

    const first = await listWorkspaces(accessToken);
    expect(first.status).toBe(200);
    const data = await readWorkspaces(first);
    expect(data).toEqual([
      {
        id: expect.any(String),
        slug: local,
        name: `${local} (personal)`,
        role: "owner",
        personal: true,
        mockCount: 0,
        memberCount: 1,
        domain: "example.com",
        domainJoinAvailable: true,
        domainJoinEnabled: false,
        defaultValidate: true,
        defaultCors: true,
      },
    ]);

    const second = await readWorkspaces(await listWorkspaces(accessToken));
    expect(second[0]?.id).toBe(data[0]?.id);
    const rows = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.personalOwnerId, user.id));
    expect(rows).toHaveLength(1);
  });

  test("concurrent first visits create exactly one workspace", async () => {
    const { user, accessToken } = await newUser();
    const responses = await Promise.all([1, 2, 3, 4].map(() => listWorkspaces(accessToken)));
    const ids = await Promise.all(responses.map(async (res) => (await readWorkspaces(res))[0]?.id));
    expect(new Set(ids).size).toBe(1);
    const rows = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.personalOwnerId, user.id));
    expect(rows).toHaveLength(1);
  });

  test("requires a bearer token", async () => {
    expect((await listWorkspaces(undefined)).status).toBe(401);
  });

  test("APP_GOOGLE_ALLOWED_HD rejects off-domain accounts", async () => {
    const { accessToken } = await newUser(`outsider-${crypto.randomUUID()}@other.test`);
    const res = await listWorkspaces(accessToken, buildApp("example.com"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "DOMAIN_NOT_ALLOWED" } });
  });
  test("the last-used workspace comes first", async () => {
    const { user, accessToken } = await newUser();
    const [personal] = await readWorkspaces(await listWorkspaces(accessToken));
    const team = await sharedWorkspace(user.id, "viewer");

    expect((await callScoped(accessToken, "GET", `${team.slug}/mocks`)).status).toBe(200);
    const afterTeam = await readWorkspaces(await listWorkspaces(accessToken));
    expect(afterTeam.map((ws) => ws.slug)).toEqual([team.slug, personal?.slug ?? ""]);

    expect((await callScoped(accessToken, "GET", `${personal?.slug}/mocks`)).status).toBe(200);
    const afterPersonal = await readWorkspaces(await listWorkspaces(accessToken));
    expect(afterPersonal.map((ws) => ws.slug)).toEqual([personal?.slug ?? "", team.slug]);
  });
});

describe("workspace roles on mock routes", () => {
  test("a Viewer can list mocks but not create them", async () => {
    const { user, accessToken } = await newUser();
    const team = await sharedWorkspace(user.id, "viewer");

    expect((await callScoped(accessToken, "GET", `${team.slug}/mocks`)).status).toBe(200);
    const res = await callScoped(accessToken, "POST", `${team.slug}/mocks`, {
      name: "Pets",
      slug: "pets",
      source: { type: "file", filename: "pets.yaml", content: "openapi: 3.0.0" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: "FORBIDDEN", message: NO_PERMISSION },
    });
  });
});
