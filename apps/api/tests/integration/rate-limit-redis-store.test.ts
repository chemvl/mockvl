import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { createApp } from "@/app";
import { closeRedis, createRedis } from "@/lib/redis";
import { createRedisRateLimitStore } from "@/middleware/rate-limit-redis-store";

// Integration tests — they require the compose Redis from docker-compose.yml
// to be up (docker compose up -d).

// Own client (not the shared singleton): test files share a process and
// redis.test.ts closes the singleton in its afterAll.
const client = createRedis(String(process.env.REDIS_URL));

// Unique prefix per run: rate-limit keys persist in Redis between test runs.
const runPrefix = `rl:test:${crypto.randomUUID()}:`;

afterAll(async () => {
  await closeRedis(client);
});

function makeStore(prefix: string, windowMs: number) {
  const store = createRedisRateLimitStore({ client, prefix, failOpen: true });
  store.init?.({ windowMs } as never);
  return store;
}

describe("createRedisRateLimitStore against the compose Redis", () => {
  test("increment counts hits and reports a reset time inside the window", async () => {
    const store = makeStore(`${runPrefix}count:`, 60_000);
    const before = Date.now();

    const first = await store.increment("client-a");
    const second = await store.increment("client-a");

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(second.resetTime).toBeInstanceOf(Date);
    const resetMs = (second.resetTime as Date).getTime() - before;
    expect(resetMs).toBeGreaterThan(0);
    expect(resetMs).toBeLessThanOrEqual(61_000);
  });

  test("clients are counted independently", async () => {
    const store = makeStore(`${runPrefix}independent:`, 60_000);

    await store.increment("client-a");
    const other = await store.increment("client-b");

    expect(other.totalHits).toBe(1);
  });

  test("two store instances with one prefix share the counter (multi-instance)", async () => {
    const storeA = makeStore(`${runPrefix}shared:`, 60_000);
    const storeB = makeStore(`${runPrefix}shared:`, 60_000);

    await storeA.increment("client-a");
    await storeB.increment("client-a");
    const third = await storeA.increment("client-a");

    expect(third.totalHits).toBe(3);
  });

  test("the window rolls over: counter restarts after windowMs", async () => {
    const store = makeStore(`${runPrefix}rollover:`, 250);

    await store.increment("client-a");
    await store.increment("client-a");
    await Bun.sleep(400);
    const afterWindow = await store.increment("client-a");

    expect(afterWindow.totalHits).toBe(1);
  });

  test("decrement never creates an immortal counter for a rolled-over key", async () => {
    const store = makeStore(`${runPrefix}decr:`, 60_000);

    // The key does not exist (window already rolled over / never started).
    await store.decrement("client-a");

    // DECR alone would have created the key at -1 with NO expiry, making the
    // counter immortal. Whatever the store leaves behind must carry a TTL.
    const pttl = await client.pttl(`${runPrefix}decr:client-a`);
    expect(pttl === -2 || pttl > 0).toBe(true); // -2 = key absent, >0 = expiring
    expect(pttl).not.toBe(-1); // -1 = exists without expiry
  });

  test("resetKey clears the counter", async () => {
    const store = makeStore(`${runPrefix}reset:`, 60_000);

    await store.increment("client-a");
    await store.resetKey("client-a");
    const after = await store.increment("client-a");

    expect(after.totalHits).toBe(1);
  });
});

describe("two app instances sharing one Redis-backed limit", () => {
  test("the limit applies across instances: 4th request over both apps is 429", async () => {
    const settings = {
      windowMs: 60_000,
      limit: 3,
      store: undefined as unknown,
    };
    // Each instance gets its own store object (as separate processes would)
    // but they share the prefix, so Redis holds one counter.
    const appA = createApp({
      rateLimit: {
        global: {
          ...settings,
          store: createRedisRateLimitStore({
            client,
            prefix: `${runPrefix}apps:`,
            failOpen: true,
          }),
        },
      },
    });
    const appB = createApp({
      rateLimit: {
        global: {
          ...settings,
          store: createRedisRateLimitStore({
            client,
            prefix: `${runPrefix}apps:`,
            failOpen: true,
          }),
        },
      },
    });

    const statuses: number[] = [];
    for (const app of [appA, appB, appA, appB]) {
      const res = await app.request("/api/users/me");
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
  });
});
