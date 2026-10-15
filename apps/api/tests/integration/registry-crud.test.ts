import "../setup";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { createCrudRepo } from "@/admin/registry/crud.repo";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import type { ListQuery } from "@/lib/pagination";
import { prepareTestDatabase } from "../helpers/test-db";

const { posts, users } = schema;

// Integration tests — require the compose Postgres (docker compose up -d);
// the test database is created and migrated by prepareTestDatabase().
await prepareTestDatabase();

// Own pool so closing it can't break other test files sharing the process.
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });

const repo = createCrudRepo(db, posts);

// Unique per run: rows persist across runs if cleanup is interrupted, and the
// suite must never depend on a pristine table.
const runTag = crypto.randomUUID();
let authorId: string;

function listQuery(overrides: Partial<ListQuery> = {}): ListQuery {
  return {
    page: 1,
    pageSize: 20,
    sort: [{ field: "title", dir: "asc" }],
    // Scope every list to this run's rows.
    filters: [{ field: "authorId", op: "eq", value: authorId }],
    ...overrides,
  };
}

beforeAll(async () => {
  const [author] = await db
    .insert(users)
    .values({ email: `crud-${runTag}@example.com`, passwordHash: "x" })
    .returning();
  if (!author) throw new Error("author insert failed");
  authorId = author.id;

  await db.insert(posts).values([
    { title: `${runTag} alpha`, status: "draft", content: "first", authorId },
    { title: `${runTag} beta`, status: "published", content: null, authorId },
    { title: `${runTag} gamma`, status: "published", content: "third", authorId },
  ]);
});

afterAll(async () => {
  // Deleting the author cascades to this run's posts.
  await db.delete(users).where(eq(users.id, authorId));
  await pool.end({ timeout: 5 });
});

describe("crud repo mutations", () => {
  test("insert returns the created row with column defaults applied", async () => {
    const row = await repo.insert({ title: `${runTag} inserted`, authorId });
    expect(row.status).toBe("draft");
    expect(row.id).toBeString();
    expect(row.createdAt).toBeInstanceOf(Date);
    await repo.delete(row.id as string);
  });

  test("findById returns the row, undefined for an unknown id", async () => {
    const row = await repo.insert({ title: `${runTag} findable`, authorId });
    const found = await repo.findById(row.id as string);
    expect(found?.title).toBe(`${runTag} findable`);
    expect(await repo.findById(crypto.randomUUID())).toBeUndefined();
    await repo.delete(row.id as string);
  });

  test("update patches only the given fields, undefined for an unknown id", async () => {
    const row = await repo.insert({ title: `${runTag} original`, authorId, content: "keep" });
    const updated = await repo.update(row.id as string, { title: `${runTag} patched` });
    expect(updated?.title).toBe(`${runTag} patched`);
    expect(updated?.content).toBe("keep");
    expect(await repo.update(crypto.randomUUID(), { title: "x" })).toBeUndefined();
    await repo.delete(row.id as string);
  });

  test("delete returns the deleted row once, then undefined", async () => {
    const row = await repo.insert({ title: `${runTag} doomed`, authorId });
    const deleted = await repo.delete(row.id as string);
    expect(deleted?.title).toBe(`${runTag} doomed`);
    expect(await repo.delete(row.id as string)).toBeUndefined();
  });
});

describe("crud repo list (PLAN §4.2 convention)", () => {
  test("paginates with a stable order and reports the unpaginated total", async () => {
    const pageOne = await repo.list(listQuery({ pageSize: 2 }));
    expect(pageOne.total).toBe(3);
    expect(pageOne.rows.map((row) => row.title)).toEqual([`${runTag} alpha`, `${runTag} beta`]);

    const pageTwo = await repo.list(listQuery({ pageSize: 2, page: 2 }));
    expect(pageTwo.total).toBe(3);
    expect(pageTwo.rows.map((row) => row.title)).toEqual([`${runTag} gamma`]);
  });

  test("sorts descending", async () => {
    const result = await repo.list(listQuery({ sort: [{ field: "title", dir: "desc" }] }));
    expect(result.rows[0]?.title).toBe(`${runTag} gamma`);
  });

  test("filters: eq, in, and like are ANDed together", async () => {
    const published = await repo.list(
      listQuery({
        filters: [
          { field: "authorId", op: "eq", value: authorId },
          { field: "status", op: "eq", value: "published" },
        ],
      }),
    );
    expect(published.total).toBe(2);

    const inList = await repo.list(
      listQuery({
        filters: [
          { field: "authorId", op: "eq", value: authorId },
          { field: "status", op: "in", value: ["draft"] },
        ],
      }),
    );
    expect(inList.rows.map((row) => row.title)).toEqual([`${runTag} alpha`]);

    const like = await repo.list(
      listQuery({
        filters: [
          { field: "authorId", op: "eq", value: authorId },
          { field: "title", op: "like", value: "GAMM" },
        ],
      }),
    );
    expect(like.rows.map((row) => row.title)).toEqual([`${runTag} gamma`]);
  });

  test("like treats % and _ literally (no wildcard injection)", async () => {
    const row = await repo.insert({ title: `${runTag} 100% done`, authorId });
    const literal = await repo.list(
      listQuery({
        filters: [
          { field: "authorId", op: "eq", value: authorId },
          { field: "title", op: "like", value: "100% done" },
        ],
      }),
    );
    expect(literal.rows.map((r) => r.title)).toEqual([`${runTag} 100% done`]);

    // A bare "%" must not match every row — it is data, not a wildcard.
    const percent = await repo.list(
      listQuery({
        filters: [
          { field: "authorId", op: "eq", value: authorId },
          { field: "title", op: "like", value: "0%_d" },
        ],
      }),
    );
    expect(percent.total).toBe(0);
    await repo.delete(row.id as string);
  });

  test("filters on timestamps with gte/lte", async () => {
    // Bounds derive from the rows' own Postgres-stamped createdAt, with ±1s
    // margins — never exact and never the host clock. Two traps live here:
    // the Docker VM clock drifts from the host under load (an `lte now()`
    // bound flaked), and the JS Date echo is truncated to milliseconds while
    // timestamptz keeps microseconds, so a row compared against its own
    // echoed timestamp can fall on either side of it.
    const all = await repo.list(listQuery());
    const stamps = all.rows.map((row) => (row.createdAt as Date).getTime());
    const before = new Date(Math.min(...stamps) - 1_000).toISOString();
    const after = new Date(Math.max(...stamps) + 1_000).toISOString();

    const cases: { op: "gte" | "lte"; value: string; total: number }[] = [
      { op: "gte", value: after, total: 0 },
      { op: "gte", value: before, total: 3 },
      { op: "lte", value: before, total: 0 },
      { op: "lte", value: after, total: 3 },
    ];
    for (const { op, value, total } of cases) {
      const result = await repo.list(
        listQuery({
          filters: [
            { field: "authorId", op: "eq", value: authorId },
            { field: "createdAt", op, value },
          ],
        }),
      );
      expect(result.total).toBe(total);
    }
  });
});
