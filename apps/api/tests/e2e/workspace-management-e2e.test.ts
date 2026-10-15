import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { type Workspace, WorkspaceSchema } from "@starter/schemas";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { createWorkspacesRepo } from "@/modules/workspaces/workspaces.repo";
import { createTestUser } from "../helpers/app-user";
import { createMockvlServices } from "../helpers/mockvl";
import { prepareTestDatabase } from "../helpers/test-db";

await prepareTestDatabase();
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const userIds: string[] = [];
const workspaceIds: string[] = [];
const invalidated: string[] = [];

const services = createMockvlServices(db, { invalidated });
const app = createApp({
  workspacesService: services.workspacesService,
  mocksService: services.mocksService,
  rateLimit: { global: { windowMs: 60_000, limit: 10_000 } },
});

afterAll(async () => {
  // Audit rows have no FK, so they outlive the cascade from users.
  if (workspaceIds.length > 0) {
    await db
      .delete(schema.workspaceAuditEvents)
      .where(inArray(schema.workspaceAuditEvents.workspaceId, workspaceIds));
  }
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await pool.end({ timeout: 5 });
});

async function newUser() {
  const created = await createTestUser(db);
  userIds.push(created.user.id);
  return created;
}

const uniqueSlug = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function call(token: string, method: string, path: string, body?: unknown) {
  return app.request(`/api/workspaces${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function readWorkspace(res: Response): Promise<Workspace> {
  const body = (await res.json()) as { data: unknown };
  return WorkspaceSchema.parse(body.data);
}

async function createWorkspace(token: string, slug = uniqueSlug("mg")) {
  const res = await call(token, "POST", "", { name: "Platform Team", slug });
  expect(res.status).toBe(201);
  const workspace = await readWorkspace(res);
  workspaceIds.push(workspace.id);
  return workspace;
}

async function addMember(workspaceId: string, userId: string, role: "admin" | "editor" | "viewer") {
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

describe("POST /workspaces", () => {
  test("creates a workspace owned by the caller", async () => {
    const { accessToken } = await newUser();
    const slug = uniqueSlug("mg");
    const workspace = await createWorkspace(accessToken, slug);
    expect(workspace).toMatchObject({
      slug,
      name: "Platform Team",
      role: "owner",
      personal: false,
      memberCount: 1,
      domain: "example.com",
    });
  });

  test("rejects taken, reserved and invalid slugs", async () => {
    const { accessToken } = await newUser();
    const { slug } = await createWorkspace(accessToken);

    const duplicate = await call(accessToken, "POST", "", { name: "Dup", slug });
    expect(duplicate.status).toBe(409);
    expect(await errorCode(duplicate)).toBe("SLUG_TAKEN");

    const reserved = await call(accessToken, "POST", "", { name: "Api", slug: "api" });
    expect(reserved.status).toBe(409);
    expect(await errorCode(reserved)).toBe("SLUG_RESERVED");

    const invalid = await call(accessToken, "POST", "", { name: "Digits", slug: "1ab" });
    expect(invalid.status).toBe(400);
    expect(await errorCode(invalid)).toBe("SLUG_INVALID");
  });
});

describe("PATCH /workspaces/{ws}", () => {
  test("a slug change moves the route cache, reserves the old slug and is audited", async () => {
    const { accessToken } = await newUser();
    const before = await createWorkspace(accessToken);
    const next = uniqueSlug("mg");

    const res = await call(accessToken, "PATCH", `/${before.slug}`, { slug: next });
    expect(res.status).toBe(200);
    expect(await readWorkspace(res)).toMatchObject({ id: before.id, slug: next, role: "owner" });
    expect(invalidated).toContain(`cache:mocks:route:${before.slug}/*`);
    expect(invalidated).toContain(`cache:mocks:route:${next}/*`);

    const other = await newUser();
    const stolen = await call(other.accessToken, "POST", "", { name: "Other", slug: before.slug });
    expect(stolen.status).toBe(409);
    expect(await errorCode(stolen)).toBe("SLUG_TAKEN");

    const own = await call(accessToken, "GET", `/slug-available?slug=${before.slug}&ws=${next}`);
    expect(await own.json()).toEqual({
      data: { slug: before.slug, available: true, reason: null },
    });
    const foreign = await call(other.accessToken, "GET", `/slug-available?slug=${before.slug}`);
    expect(await foreign.json()).toEqual({
      data: { slug: before.slug, available: false, reason: "taken" },
    });

    const audit = await db
      .select()
      .from(schema.workspaceAuditEvents)
      .where(
        and(
          eq(schema.workspaceAuditEvents.workspaceId, before.id),
          eq(schema.workspaceAuditEvents.action, "slug_changed"),
        ),
      );
    expect(audit.map((row) => row.details)).toEqual([{ from: before.slug, to: next }]);
  });

  test("updates settings; domain join is refused on consumer domains", async () => {
    const { accessToken } = await newUser();
    const workspace = await createWorkspace(accessToken);

    const res = await call(accessToken, "PATCH", `/${workspace.slug}`, {
      name: "Renamed",
      defaultValidate: false,
      domainJoinEnabled: true,
    });
    expect(res.status).toBe(200);
    expect(await readWorkspace(res)).toMatchObject({
      name: "Renamed",
      defaultValidate: false,
      defaultCors: true,
      domainJoinEnabled: true,
    });

    await db
      .update(schema.workspaces)
      .set({ domain: "gmail.com", domainJoinEnabled: false })
      .where(eq(schema.workspaces.id, workspace.id));
    const consumer = await call(accessToken, "PATCH", `/${workspace.slug}`, {
      name: "Not applied",
      domainJoinEnabled: true,
    });
    expect(consumer.status).toBe(400);
    expect(await errorCode(consumer)).toBe("DOMAIN_JOIN_UNAVAILABLE");
    const [row] = await db
      .select({ name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspace.id));
    expect(row?.name).toBe("Renamed");
  });

  test("an Editor cannot change settings and a Viewer cannot transfer", async () => {
    const owner = await newUser();
    const editor = await newUser();
    const viewer = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await addMember(workspace.id, editor.user.id, "editor");
    await addMember(workspace.id, viewer.user.id, "viewer");

    const patch = await call(editor.accessToken, "PATCH", `/${workspace.slug}`, { name: "X" });
    expect(patch.status).toBe(403);
    expect(await errorCode(patch)).toBe("FORBIDDEN");

    const transfer = await call(viewer.accessToken, "POST", `/${workspace.slug}/transfer`, {
      userId: editor.user.id,
    });
    expect(transfer.status).toBe(403);
  });
});

describe("DELETE /workspaces/{ws}", () => {
  test("requires the slug, then hides the workspace and its mocks", async () => {
    const { accessToken } = await newUser();
    const workspace = await createWorkspace(accessToken);

    const wrong = await call(accessToken, "DELETE", `/${workspace.slug}`, { confirmSlug: "nope" });
    expect(wrong.status).toBe(400);
    expect(await errorCode(wrong)).toBe("CONFIRM_MISMATCH");

    const res = await call(accessToken, "DELETE", `/${workspace.slug}`, {
      confirmSlug: workspace.slug,
    });
    expect(res.status).toBe(204);
    expect(invalidated).toContain(`cache:mocks:route:${workspace.slug}/*`);
    expect((await call(accessToken, "GET", `/${workspace.slug}/mocks`)).status).toBe(404);
    const list = (await (await call(accessToken, "GET", "")).json()) as { data: Workspace[] };
    expect(list.data.map((ws) => ws.id)).not.toContain(workspace.id);
  });

  test("the only workspace, when personal, cannot be deleted", async () => {
    const { accessToken } = await newUser();
    const list = (await (await call(accessToken, "GET", "")).json()) as { data: Workspace[] };
    const personal = list.data[0];
    if (!personal) throw new Error("personal workspace missing");
    workspaceIds.push(personal.id);

    const res = await call(accessToken, "DELETE", `/${personal.slug}`, {
      confirmSlug: personal.slug,
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("LAST_WORKSPACE");
  });

  test("the purge hard-deletes it after the retention window and frees the slug", async () => {
    const { accessToken } = await newUser();
    const workspace = await createWorkspace(accessToken);
    await call(accessToken, "DELETE", `/${workspace.slug}`, { confirmSlug: workspace.slug });
    await db
      .update(schema.workspaces)
      .set({ deletedAt: sql`now() - interval '31 days'` })
      .where(eq(schema.workspaces.id, workspace.id));

    const repo = createWorkspacesRepo(db);
    expect(await repo.slugTaken(workspace.slug, null)).toBe(true);
    const purged = await repo.purgeDeleted(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await repo.slugTaken(workspace.slug, null)).toBe(false);
  });
});

describe("POST /workspaces/{ws}/transfer", () => {
  test("only an Admin can become owner", async () => {
    const owner = await newUser();
    const editor = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await addMember(workspace.id, editor.user.id, "editor");

    const res = await call(owner.accessToken, "POST", `/${workspace.slug}/transfer`, {
      userId: editor.user.id,
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("TRANSFER_TARGET_INVALID");
  });

  test("swaps owner and admin and moves owner_id", async () => {
    const owner = await newUser();
    const admin = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await addMember(workspace.id, admin.user.id, "admin");

    const res = await call(owner.accessToken, "POST", `/${workspace.slug}/transfer`, {
      userId: admin.user.id,
    });
    expect(res.status).toBe(200);
    expect(await readWorkspace(res)).toMatchObject({ id: workspace.id, role: "admin" });

    const members = await db
      .select({ userId: schema.workspaceMembers.userId, role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, workspace.id));
    expect(Object.fromEntries(members.map((m) => [m.userId, m.role]))).toEqual({
      [owner.user.id]: "admin",
      [admin.user.id]: "owner",
    });
    const [row] = await db
      .select({ ownerId: schema.workspaces.ownerId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspace.id));
    expect(row?.ownerId).toBe(admin.user.id);
  });
});

describe("POST /workspaces/{ws}/leave", () => {
  test("the owner must transfer first; others leave and are recorded", async () => {
    const owner = await newUser();
    const editor = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await addMember(workspace.id, editor.user.id, "editor");

    const ownerLeave = await call(owner.accessToken, "POST", `/${workspace.slug}/leave`);
    expect(ownerLeave.status).toBe(409);
    expect(await errorCode(ownerLeave)).toBe("OWNER_CANNOT_LEAVE");

    const res = await call(editor.accessToken, "POST", `/${workspace.slug}/leave`);
    expect(res.status).toBe(204);
    const exits = await db
      .select()
      .from(schema.workspaceMemberExits)
      .where(
        and(
          eq(schema.workspaceMemberExits.workspaceId, workspace.id),
          eq(schema.workspaceMemberExits.userId, editor.user.id),
        ),
      );
    expect(exits).toHaveLength(1);
    expect((await call(editor.accessToken, "GET", `/${workspace.slug}/mocks`)).status).toBe(404);
  });
});
