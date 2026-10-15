import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { createApp } from "@/app";
import { createPool, pingDatabase } from "@/db/client";
import { closeRedis, createRedis, pingRedis } from "@/lib/redis";
import { prepareTestDatabase } from "../helpers/test-db";

// Integration tests — they require the compose Postgres + Redis from
// docker-compose.yml to be up (docker compose up -d).
await prepareTestDatabase();

// Own pool, not the shared `db` one: test files share a process and
// db.test.ts closes the shared pool in its afterAll (file order varies).
const dbPool = createPool(String(process.env.DATABASE_URL));

// Port 1 is never a Redis; connection is refused immediately.
const unreachableRedis = createRedis("redis://127.0.0.1:1");

afterAll(async () => {
  await closeRedis(unreachableRedis);
  await closeRedis();
  await dbPool.end({ timeout: 1 });
});

describe("pingRedis", () => {
  test("resolves against the compose Redis", async () => {
    await expect(pingRedis()).resolves.toBeUndefined();
  });

  test("rejects fast when Redis is unreachable instead of hanging", async () => {
    await expect(pingRedis(unreachableRedis)).rejects.toThrow();
  });
});

describe("closeRedis", () => {
  test("closes cleanly and further commands reject", async () => {
    const client = createRedis(String(process.env.REDIS_URL));
    await pingRedis(client);

    await expect(closeRedis(client)).resolves.toBeUndefined();
    await expect(pingRedis(client)).rejects.toThrow();
  });

  test("closes a lazy client that never connected", async () => {
    const client = createRedis(String(process.env.REDIS_URL));

    await expect(closeRedis(client)).resolves.toBeUndefined();
  });
});

describe("GET /ready with real DB + Redis checks", () => {
  test("returns 200 while both dependencies are up", async () => {
    const app = createApp({
      readinessChecks: [
        { name: "db", check: () => pingDatabase(dbPool) },
        { name: "redis", check: () => pingRedis() },
      ],
    });
    const res = await app.request("/api/ready");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "ready" } });
  });

  test("returns 503 identifying redis when only Redis is down", async () => {
    const app = createApp({
      readinessChecks: [
        { name: "db", check: () => pingDatabase(dbPool) },
        { name: "redis", check: () => pingRedis(unreachableRedis) },
      ],
    });
    const res = await app.request("/api/ready");
    const body = (await res.json()) as { error: { code: string; details: unknown } };

    expect(res.status).toBe(503);
    expect(body.error.code).toBe("NOT_READY");
    expect(body.error.details).toEqual([{ name: "redis" }]);
  });
});
