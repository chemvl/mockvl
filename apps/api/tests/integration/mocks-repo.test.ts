import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import type { ListQuery } from "@/lib/pagination";
import {
  createMocksRepo,
  type NewMockInput,
  type NewVersionInput,
} from "@/modules/mocks/mocks.repo";
import { createWorkspacesRepo } from "@/modules/workspaces/workspaces.repo";
import { createTestUser } from "../helpers/app-user";
import { prepareTestDatabase } from "../helpers/test-db";

await prepareTestDatabase();
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const repo = createMocksRepo(db);
const userIds: string[] = [];

afterAll(async () => {
  if (userIds.length > 0) await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await pool.end({ timeout: 5 });
});

const QUERY: ListQuery = { page: 1, pageSize: 20, sort: [], filters: [] };

async function workspaceWithOwner() {
  const { user } = await createTestUser(db);
  userIds.push(user.id);
  const workspace = await createWorkspacesRepo(db).insertWorkspace({
    slug: `repo-${crypto.randomUUID().slice(0, 8)}`,
    name: "Repo workspace",
    ownerId: user.id,
    domain: "example.com",
    personal: true,
  });
  return { user, workspace };
}

function mockInput(workspaceId: string, slug: string, createdBy: string): NewMockInput {
  return {
    workspaceId,
    name: slug.toUpperCase(),
    slug,
    responseMode: "static",
    validateRequests: true,
    cors: true,
    sourceType: "file",
    sourceUrl: null,
    createdBy,
  };
}

function versionInput(createdBy: string, content = "{}"): NewVersionInput {
  return {
    action: "create",
    sourceLabel: "pets.yaml",
    restoredFrom: null,
    format: "openapi3",
    specVersion: "3.0.3",
    content,
    contentSha256: `sha-${content}`,
    sizeBytes: content.length,
    endpointCount: 2,
    exampleCount: 1,
    operations: [],
    diff: null,
    customEndpoints: null,
    createdBy,
  };
}

describe("mocks repo", () => {
  test("createWithVersion → findDetail, findRoute, findVersionSource", async () => {
    const { user, workspace } = await workspaceWithOwner();
    const id = await repo.createWithVersion(
      mockInput(workspace.id, "pets", user.id),
      versionInput(user.id, "body"),
    );

    const detail = await repo.findDetail(workspace.id, "pets");
    expect(detail).toMatchObject({
      id,
      slug: "pets",
      status: "running",
      endpointCount: 2,
      requests24h: 0,
      versionCount: 1,
      createdBy: { id: user.id, email: user.email },
      updatedBy: { id: user.id, email: user.email },
      liveVersion: { number: 1, sourceLabel: "pets.yaml", contentSha256: "sha-body" },
    });

    const route = await repo.findRoute(workspace.slug, "pets");
    expect(route).toEqual({
      mockId: id,
      liveVersionId: detail?.liveVersionId ?? "",
      status: "running",
      responseMode: "static",
      validateRequests: true,
      cors: true,
    });
    expect(await repo.findRoute(workspace.slug, "nope")).toBeNull();
    expect(await repo.findVersionSource(detail?.liveVersionId ?? "")).toEqual({
      content: "body",
      format: "openapi3",
    });
    expect(await repo.slugExists(workspace.id, "pets")).toBe(true);
    expect(await repo.countInWorkspace(workspace.id)).toBe(1);
  });

  test("appendVersion numbers sequentially and keeps the newest 20", async () => {
    const { user, workspace } = await workspaceWithOwner();
    const id = await repo.createWithVersion(
      mockInput(workspace.id, "many", user.id),
      versionInput(user.id),
    );
    const numbers: number[] = [];
    for (let i = 0; i < 22; i++) {
      numbers.push(
        (await repo.appendVersion(
          id,
          { ...versionInput(user.id, `v${i}`), action: "replace" },
          { updatedBy: user.id },
        )) as number,
      );
    }
    expect(numbers).toEqual(Array.from({ length: 22 }, (_, i) => i + 2));
    const versions = await repo.listVersions(id);
    expect(versions).toHaveLength(20);
    expect(versions[0]?.number).toBe(23);
    expect(versions.at(-1)?.number).toBe(4);
    expect((await repo.findDetail(workspace.id, "many"))?.liveVersion.number).toBe(23);
  });

  test("concurrent appends never collide", async () => {
    const { user, workspace } = await workspaceWithOwner();
    const id = await repo.createWithVersion(
      mockInput(workspace.id, "race", user.id),
      versionInput(user.id),
    );
    const numbers = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        repo.appendVersion(
          id,
          { ...versionInput(user.id, `r${i}`), action: "replace" },
          { updatedBy: user.id },
        ),
      ),
    );
    expect([...numbers].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([2, 3, 4, 5, 6]);
  });

  test("list: requests24h window, q, createdById, status filter, sort", async () => {
    const { user, workspace } = await workspaceWithOwner();
    const { user: other } = await createTestUser(db);
    userIds.push(other.id);
    const alphaId = await repo.createWithVersion(
      mockInput(workspace.id, "alpha", user.id),
      versionInput(user.id),
    );
    const betaId = await repo.createWithVersion(
      mockInput(workspace.id, "beta", other.id),
      versionInput(other.id),
    );
    await repo.update(betaId, { status: "paused", updatedBy: other.id });

    const thisHour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    await db.insert(schema.mockUsageHourly).values([
      { mockId: alphaId, hour: thisHour, requests: 5, clientErrors: 1, serverErrors: 0 },
      {
        mockId: alphaId,
        hour: new Date(thisHour.getTime() - 30 * 3_600_000),
        requests: 100,
        clientErrors: 0,
        serverErrors: 0,
      },
    ]);

    const all = await repo.list(workspace.id, {
      query: { ...QUERY, sort: [{ field: "name", dir: "asc" }] },
    });
    expect(all.total).toBe(2);
    expect(all.rows.map((row) => [row.slug, row.requests24h])).toEqual([
      ["alpha", 5],
      ["beta", 0],
    ]);
    expect(all.rows[1]?.updatedBy).toEqual({ id: other.id, name: null, email: other.email });

    const slugs = async (options: Parameters<typeof repo.list>[1]) =>
      (await repo.list(workspace.id, options)).rows.map((row) => row.slug);
    expect(await slugs({ query: QUERY, q: "ALP" })).toEqual(["alpha"]);
    expect(await slugs({ query: QUERY, q: "%" })).toEqual([]);
    expect(await slugs({ query: QUERY, createdById: other.id })).toEqual(["beta"]);
    expect(
      await slugs({
        query: { ...QUERY, filters: [{ field: "status", op: "eq", value: "paused" }] },
      }),
    ).toEqual(["beta"]);
    expect(await slugs({ query: { ...QUERY, sort: [{ field: "name", dir: "desc" }] } })).toEqual([
      "beta",
      "alpha",
    ]);
    // Default sort: most recently updated first (beta was updated last).
    expect(await slugs({ query: QUERY })).toEqual(["beta", "alpha"]);
  });

  test("delete removes the mock", async () => {
    const { user, workspace } = await workspaceWithOwner();
    const id = await repo.createWithVersion(
      mockInput(workspace.id, "gone", user.id),
      versionInput(user.id),
    );
    await repo.delete(id);
    expect(await repo.findDetail(workspace.id, "gone")).toBeUndefined();
  });
});
