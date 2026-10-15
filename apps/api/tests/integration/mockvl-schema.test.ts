import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { prepareTestDatabase } from "../helpers/test-db";

const {
  users,
  workspaces,
  workspaceMembers,
  mocks,
  mockVersions,
  mockUsageHourly,
  mockResponseOverrides,
} = schema;

// Requires the compose Postgres (docker compose up -d); the test database is
// created and migrated by prepareTestDatabase().
await prepareTestDatabase();

const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const userIds: string[] = [];

afterAll(async () => {
  // Personal workspaces cascade from their owner, mocks from their workspace.
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
  await pool.end({ timeout: 5 });
});

async function insertUser() {
  const [user] = await db
    .insert(users)
    .values({ email: `mockvl-schema-${crypto.randomUUID()}@example.com`, passwordHash: null })
    .returning();
  if (!user) throw new Error("user insert returned no row");
  userIds.push(user.id);
  return user;
}

// The single-owner trigger checks at commit, so the workspace and its owner
// membership go in one transaction.
async function insertWorkspace(ownerId: string, slug = `ws-${crypto.randomUUID().slice(0, 8)}`) {
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        slug,
        name: "Test workspace",
        personalOwnerId: ownerId,
        ownerId,
        domain: "example.com",
      })
      .returning();
    if (!workspace) throw new Error("workspace insert returned no row");
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: ownerId, role: "owner" });
    return workspace;
  });
}

async function insertMock(workspaceId: string, slug: string, authorId: string | null = null) {
  const [mock] = await db
    .insert(mocks)
    .values({
      workspaceId,
      name: "Pets",
      slug,
      sourceType: "file",
      createdBy: authorId,
      updatedBy: authorId,
    })
    .returning();
  if (!mock) throw new Error("mock insert returned no row");
  return mock;
}

async function insertVersion(mockId: string, number: number) {
  const [version] = await db
    .insert(mockVersions)
    .values({
      mockId,
      number,
      action: "create",
      sourceLabel: "pets.yaml",
      format: "openapi3",
      specVersion: "3.0.3",
      content: "{}",
      contentSha256: "0".repeat(64),
      sizeBytes: 2,
      endpointCount: 0,
      exampleCount: 0,
      operations: [],
      diff: null,
    })
    .returning();
  if (!version) throw new Error("version insert returned no row");
  return version;
}

describe("Mockvl tables", () => {
  test("workspace slugs are globally unique and each user has one personal workspace", async () => {
    const owner = await insertUser();
    const other = await insertUser();
    const workspace = await insertWorkspace(owner.id);
    await expect(insertWorkspace(other.id, workspace.slug)).rejects.toThrow();
    await expect(insertWorkspace(owner.id)).rejects.toThrow();
  });

  test("mock slugs are unique per workspace but reusable across workspaces", async () => {
    const a = await insertWorkspace((await insertUser()).id);
    const b = await insertWorkspace((await insertUser()).id);
    await insertMock(a.id, "pets");
    await expect(insertMock(a.id, "pets")).rejects.toThrow();
    expect((await insertMock(b.id, "pets")).slug).toBe("pets");
  });

  test("version numbers are unique per mock", async () => {
    const workspace = await insertWorkspace((await insertUser()).id);
    const mock = await insertMock(workspace.id, "numbers");
    await insertVersion(mock.id, 1);
    await expect(insertVersion(mock.id, 1)).rejects.toThrow();
  });

  test("deleting the live version nulls live_version_id; deleting a mock cascades", async () => {
    const workspace = await insertWorkspace((await insertUser()).id);
    const mock = await insertMock(workspace.id, "cascade");
    const version = await insertVersion(mock.id, 1);
    await db.update(mocks).set({ liveVersionId: version.id }).where(eq(mocks.id, mock.id));
    await db.insert(mockUsageHourly).values({
      mockId: mock.id,
      hour: new Date("2026-10-07T10:00:00Z"),
      requests: 3,
      clientErrors: 1,
      serverErrors: 0,
    });

    await db.delete(mockVersions).where(eq(mockVersions.id, version.id));
    const [afterVersionDelete] = await db.select().from(mocks).where(eq(mocks.id, mock.id));
    expect(afterVersionDelete?.liveVersionId).toBeNull();

    await insertVersion(mock.id, 2);
    await db.delete(mocks).where(eq(mocks.id, mock.id));
    expect(await db.select().from(mockVersions).where(eq(mockVersions.mockId, mock.id))).toEqual(
      [],
    );
    expect(
      await db.select().from(mockUsageHourly).where(eq(mockUsageHourly.mockId, mock.id)),
    ).toEqual([]);
  });

  test("deleting the owner cascades the personal workspace, membership, and their own mocks", async () => {
    const owner = await insertUser();
    const workspace = await insertWorkspace(owner.id);
    // created_by and updated_by both SET NULL the row before the workspace
    // cascade deletes it; the workspace FK must not fail on that update.
    const mock = await insertMock(workspace.id, "gone", owner.id);
    await db.delete(users).where(eq(users.id, owner.id));
    expect(await db.select().from(workspaces).where(eq(workspaces.id, workspace.id))).toEqual([]);
    expect(
      await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, owner.id)),
    ).toEqual([]);
    expect(await db.select().from(mocks).where(eq(mocks.id, mock.id))).toEqual([]);
  });

  test("a workspace keeps exactly one owner", async () => {
    const owner = await insertUser();
    const admin = await insertUser();
    const intruder = await insertUser();
    const workspace = await insertWorkspace(owner.id);
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: admin.id, role: "admin" });
    const memberOf = (userId: string) =>
      and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, userId));

    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: workspace.id, userId: intruder.id, role: "owner" });
      }),
    ).rejects.toThrow();

    await expect(
      db.transaction(async (tx) => {
        await tx.delete(workspaceMembers).where(memberOf(owner.id));
      }),
    ).rejects.toThrow();

    await db.transaction(async (tx) => {
      await tx.update(workspaceMembers).set({ role: "admin" }).where(memberOf(owner.id));
      await tx.update(workspaceMembers).set({ role: "owner" }).where(memberOf(admin.id));
      await tx.update(workspaces).set({ ownerId: admin.id }).where(eq(workspaces.id, workspace.id));
    });
    const roles = await db
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspace.id));
    expect(roles).toEqual(
      expect.arrayContaining([
        { userId: owner.id, role: "admin" },
        { userId: admin.id, role: "owner" },
      ]),
    );
  });

  test("response overrides: one row per (mock, method, path, code), kept when the author goes, gone with the mock", async () => {
    const owner = await insertUser();
    const author = await insertUser();
    const workspace = await insertWorkspace(owner.id);
    const mock = await insertMock(workspace.id, "overrides");
    const row = {
      mockId: mock.id,
      method: "get" as const,
      path: "/pets/{id}",
      statusCode: 200,
      body: '{\n  "id": 1\n}',
      updatedBy: author.id,
    };
    await db.insert(mockResponseOverrides).values(row);
    // execute(): Bun's .rejects needs a real Promise, not Drizzle's thenable builder.
    await expect(db.insert(mockResponseOverrides).values(row).execute()).rejects.toThrow();
    await db.insert(mockResponseOverrides).values({ ...row, statusCode: 404 });

    await db.delete(users).where(eq(users.id, author.id));
    const kept = await db
      .select()
      .from(mockResponseOverrides)
      .where(eq(mockResponseOverrides.mockId, mock.id))
      .orderBy(asc(mockResponseOverrides.statusCode));
    expect(kept.map((r) => [r.statusCode, r.updatedBy, r.body])).toEqual([
      [200, null, '{\n  "id": 1\n}'],
      [404, null, '{\n  "id": 1\n}'],
    ]);

    await db.delete(mocks).where(eq(mocks.id, mock.id));
    expect(
      await db
        .select()
        .from(mockResponseOverrides)
        .where(eq(mockResponseOverrides.mockId, mock.id)),
    ).toEqual([]);
  });

  test("deleting the owner who authored an override cascades it with the workspace", async () => {
    const owner = await insertUser();
    const workspace = await insertWorkspace(owner.id);
    const mock = await insertMock(workspace.id, "authored", owner.id);
    // updated_by SET NULL and the workspace → mock → override cascade run
    // in one statement; the mock_id FK must not fail on that update.
    await db.insert(mockResponseOverrides).values({
      mockId: mock.id,
      method: "get",
      path: "/x",
      statusCode: 200,
      body: "{}",
      updatedBy: owner.id,
    });
    await db.delete(users).where(eq(users.id, owner.id));
    expect(
      await db
        .select()
        .from(mockResponseOverrides)
        .where(eq(mockResponseOverrides.mockId, mock.id)),
    ).toEqual([]);
  });
});
