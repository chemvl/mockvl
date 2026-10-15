import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createApp } from "@/app";
import { closeDatabase, createPool, db, pingDatabase } from "@/db/client";
import { refreshTokens, users } from "@/db/schema";
import { prepareTestDatabase } from "../helpers/test-db";

// Integration tests — they require the compose Postgres from docker-compose.yml
// to be up (docker compose up -d); the test database itself is created and
// migrated by prepareTestDatabase().
await prepareTestDatabase();

// Port 1 is never a Postgres; connection is refused immediately.
const unreachablePool = createPool("postgres://postgres:postgres@127.0.0.1:1/app");

afterAll(async () => {
  await unreachablePool.end({ timeout: 1 });
  await closeDatabase();
});

describe("pingDatabase", () => {
  test("resolves against the compose Postgres", async () => {
    await expect(pingDatabase()).resolves.toBeUndefined();
  });

  test("rejects when the database is unreachable", async () => {
    await expect(pingDatabase(unreachablePool)).rejects.toThrow();
  });
});

describe("GET /ready with a real DB check", () => {
  test("returns 200 while the database is up", async () => {
    const app = createApp({
      readinessChecks: [{ name: "db", check: () => pingDatabase() }],
    });
    const res = await app.request("/api/ready");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "ready" } });
  });

  test("returns 503 when the database is unreachable", async () => {
    const app = createApp({
      readinessChecks: [{ name: "db", check: () => pingDatabase(unreachablePool) }],
    });
    const res = await app.request("/api/ready");
    const body = (await res.json()) as { error: { code: string; details: unknown } };

    expect(res.status).toBe(503);
    expect(body.error.code).toBe("NOT_READY");
    expect(body.error.details).toEqual([{ name: "db" }]);
  });
});

describe("schema", () => {
  const createdEmails: string[] = [];

  async function insertUser() {
    const email = `phase2-${crypto.randomUUID()}@example.com`;
    createdEmails.push(email);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash: "not-a-real-hash" })
      .returning();
    if (!user) throw new Error("insert returned no row");
    return user;
  }

  afterAll(async () => {
    for (const email of createdEmails) {
      await db.delete(users).where(eq(users.email, email));
    }
  });

  test("users + refresh_tokens round-trip with generated defaults", async () => {
    const user = await insertUser();

    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);

    const [token] = await db
      .insert(refreshTokens)
      .values({
        userId: user.id,
        tokenHash: `hash-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!token) throw new Error("insert returned no row");

    expect(token.userId).toBe(user.id);
    expect(token.revokedAt).toBeNull();
  });

  test("email uniqueness is case-insensitive", async () => {
    const user = await insertUser();

    let error: unknown;
    try {
      await db.insert(users).values({ email: user.email.toUpperCase(), passwordHash: "x" });
    } catch (caught) {
      error = caught;
    }

    // Drizzle wraps the driver error; the Postgres unique violation is the cause.
    const cause = error instanceof Error ? (error.cause as { code?: string }) : undefined;
    expect(cause?.code).toBe("23505");
  });

  test("deleting a user cascades to their refresh tokens", async () => {
    const user = await insertUser();
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: `hash-${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await db.delete(users).where(eq(users.id, user.id));

    const orphaned = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id));
    expect(orphaned).toHaveLength(0);
  });
});
