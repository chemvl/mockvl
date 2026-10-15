import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { type Workspace, type WorkspaceMember, WorkspaceSchema } from "@starter/schemas";
import { and, eq, inArray } from "drizzle-orm";
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
const workspaceIds: string[] = [];

const services = createMockvlServices(db);
const app = createApp({
  workspacesService: services.workspacesService,
  membersService: services.membersService,
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

function call(token: string, method: string, path: string, body?: unknown) {
  return app.request(`/api/workspaces${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createWorkspace(token: string): Promise<Workspace> {
  const slug = `mb-${crypto.randomUUID().slice(0, 8)}`;
  const res = await call(token, "POST", "", { name: "Platform Team", slug });
  expect(res.status).toBe(201);
  const workspace = WorkspaceSchema.parse(((await res.json()) as { data: unknown }).data);
  workspaceIds.push(workspace.id);
  return workspace;
}

async function addMember(workspaceId: string, userId: string, role: "admin" | "editor" | "viewer") {
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

async function setName(userId: string, name: string) {
  await db.update(schema.users).set({ name }).where(eq(schema.users.id, userId));
}

async function listMembers(token: string, slug: string): Promise<WorkspaceMember[]> {
  const res = await call(token, "GET", `/${slug}/members`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: WorkspaceMember[] }).data;
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

function auditEvents(workspaceId: string, action: "member_role_changed" | "member_removed") {
  return db
    .select({
      actorId: schema.workspaceAuditEvents.actorId,
      details: schema.workspaceAuditEvents.details,
    })
    .from(schema.workspaceAuditEvents)
    .where(
      and(
        eq(schema.workspaceAuditEvents.workspaceId, workspaceId),
        eq(schema.workspaceAuditEvents.action, action),
      ),
    );
}

describe("GET /workspaces/{ws}/members", () => {
  test("any member sees everyone, ordered by role then name", async () => {
    const owner = await newUser();
    const viewer = await newUser();
    const editorB = await newUser();
    const editorA = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await addMember(workspace.id, viewer.user.id, "viewer");
    await addMember(workspace.id, editorB.user.id, "editor");
    await addMember(workspace.id, editorA.user.id, "editor");
    await setName(editorB.user.id, "bob");
    await setName(editorA.user.id, "Alice");

    const members = await listMembers(viewer.accessToken, workspace.slug);
    expect(members.map((m) => m.userId)).toEqual([
      owner.user.id,
      editorA.user.id,
      editorB.user.id,
      viewer.user.id,
    ]);
    expect(members[1]).toMatchObject({
      name: "Alice",
      email: editorA.user.email,
      role: "editor",
      lastActiveAt: null,
    });
    // The viewer's own GET touched their membership.
    expect(members[3]?.lastActiveAt).not.toBeNull();
  });
});

describe("PATCH /workspaces/{ws}/members/{userId}", () => {
  test("nobody can change the owner or their own role; editors can't change roles", async () => {
    const owner = await newUser();
    const admin = await newUser();
    const editor = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await addMember(workspace.id, admin.user.id, "admin");
    await addMember(workspace.id, editor.user.id, "editor");
    const path = (userId: string) => `/${workspace.slug}/members/${userId}`;

    const onOwner = await call(admin.accessToken, "PATCH", path(owner.user.id), { role: "viewer" });
    expect(onOwner.status).toBe(403);
    expect(await errorCode(onOwner)).toBe("FORBIDDEN");

    const self = await call(admin.accessToken, "PATCH", path(admin.user.id), { role: "viewer" });
    expect(self.status).toBe(403);

    const byEditor = await call(editor.accessToken, "PATCH", path(admin.user.id), {
      role: "viewer",
    });
    expect(byEditor.status).toBe(403);

    const missing = await call(owner.accessToken, "PATCH", path(crypto.randomUUID()), {
      role: "viewer",
    });
    expect(missing.status).toBe(404);

    expect(await auditEvents(workspace.id, "member_role_changed")).toHaveLength(0);
  });

  test("the owner demotes an admin to viewer, audited", async () => {
    const owner = await newUser();
    const admin = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await addMember(workspace.id, admin.user.id, "admin");

    const res = await call(
      owner.accessToken,
      "PATCH",
      `/${workspace.slug}/members/${admin.user.id}`,
      {
        role: "viewer",
      },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: WorkspaceMember }).data).toMatchObject({
      userId: admin.user.id,
      role: "viewer",
    });

    const events = await auditEvents(workspace.id, "member_role_changed");
    expect(events).toEqual([
      { actorId: owner.user.id, details: { userId: admin.user.id, from: "admin", to: "viewer" } },
    ]);
  });
});

describe("DELETE /workspaces/{ws}/members/{userId}", () => {
  test("removes the member, records the exit and audits it", async () => {
    const owner = await newUser();
    const admin = await newUser();
    const editor = await newUser();
    const workspace = await createWorkspace(owner.accessToken);
    await addMember(workspace.id, admin.user.id, "admin");
    await addMember(workspace.id, editor.user.id, "editor");

    const onOwner = await call(
      admin.accessToken,
      "DELETE",
      `/${workspace.slug}/members/${owner.user.id}`,
    );
    expect(onOwner.status).toBe(403);

    const res = await call(
      admin.accessToken,
      "DELETE",
      `/${workspace.slug}/members/${editor.user.id}`,
    );
    expect(res.status).toBe(204);

    const members = await listMembers(owner.accessToken, workspace.slug);
    expect(members.map((m) => m.userId)).not.toContain(editor.user.id);

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
    expect(await auditEvents(workspace.id, "member_removed")).toEqual([
      { actorId: admin.user.id, details: { userId: editor.user.id, email: editor.user.email } },
    ]);
    expect((await call(editor.accessToken, "GET", `/${workspace.slug}/mocks`)).status).toBe(404);
  });
});
