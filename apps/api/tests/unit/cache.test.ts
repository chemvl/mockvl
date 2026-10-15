import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { createCache } from "@/lib/cache";
import { createLogger } from "@/lib/logger";
import { closeRedis, createRedis } from "@/lib/redis";

// Cache behavior that must hold with a *dead* Redis (port 1 refuses
// connections immediately) — no external service involved. Hit/miss/expiry
// against a live Redis live in tests/integration/cache.test.ts.
const deadRedis = createRedis("redis://127.0.0.1:1");

afterAll(async () => {
  await closeRedis(deadRedis);
});

function captureLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    level: "debug",
    destination: {
      write(msg: string) {
        lines.push(msg);
      },
    },
  });
  return { logger, lines };
}

describe("cached with Redis down (fail open — cache never takes down a read path)", () => {
  test("falls through to fn and logs a warning", async () => {
    const { logger, lines } = captureLogger();
    const { cached } = createCache({ client: deadRedis, log: logger });

    const value = await cached("cache:test:fallthrough", 60, async () => ({ n: 1 }));

    expect(value).toEqual({ n: 1 });
    const warned = lines.map((line) => JSON.parse(line)).find((entry) => entry.code);
    expect(warned?.code).toBe("CACHE_READ_FAILED");
    expect(warned?.level).toBe(40); // pino warn
  });

  test("fn errors propagate to the caller", async () => {
    const { logger } = captureLogger();
    const { cached } = createCache({ client: deadRedis, log: logger });

    await expect(
      cached("cache:test:fn-error", 60, async () => {
        throw new Error("origin failed");
      }),
    ).rejects.toThrow("origin failed");
  });
});

describe("cached stampede dedup (in-process)", () => {
  test("concurrent calls for one key share a single fn run", async () => {
    const { logger } = captureLogger();
    const { cached } = createCache({ client: deadRedis, log: logger });
    let runs = 0;
    const fn = async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return runs;
    };

    const [a, b, c] = await Promise.all([
      cached("cache:test:stampede", 60, fn),
      cached("cache:test:stampede", 60, fn),
      cached("cache:test:stampede", 60, fn),
    ]);

    expect(runs).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(c).toBe(1);
  });

  test("concurrent calls for different keys do not share fn runs", async () => {
    const { logger } = captureLogger();
    const { cached } = createCache({ client: deadRedis, log: logger });
    let runs = 0;
    const fn = async () => ++runs;

    await Promise.all([cached("cache:test:key-a", 60, fn), cached("cache:test:key-b", 60, fn)]);

    expect(runs).toBe(2);
  });

  test("with the L1 linger disabled, a later call runs fn again once settled", async () => {
    const { logger } = captureLogger();
    // l1TtlMs: 0 pins pure in-flight behavior (no linger after settle).
    const { cached } = createCache({ client: deadRedis, log: logger, l1TtlMs: 0 });
    let runs = 0;
    const fn = async () => ++runs;

    await cached("cache:test:settled", 60, fn);
    await cached("cache:test:settled", 60, fn);

    // Redis is down, so nothing was stored — the second call must re-run fn
    // instead of being stuck on the first (settled) promise.
    expect(runs).toBe(2);
  });

  test("a rejected fn does not poison the key for the next caller", async () => {
    const { logger } = captureLogger();
    const { cached } = createCache({ client: deadRedis, log: logger });
    let runs = 0;

    await expect(
      cached("cache:test:poison", 60, async () => {
        runs++;
        throw new Error("first fails");
      }),
    ).rejects.toThrow("first fails");
    const second = await cached("cache:test:poison", 60, async () => {
      runs++;
      return "recovered";
    });

    expect(second).toBe("recovered");
    expect(runs).toBe(2);
  });
});

describe("L1 promise micro-cache (in-process, works with a dead Redis)", () => {
  // Never assert around the 200ms production default — tests pin an explicit
  // l1TtlMs and an injectable clock so nothing here sleeps.
  test("a settled promise lingers: two sequential calls within the L1 TTL run fn once", async () => {
    const { logger } = captureLogger();
    const { cached } = createCache({ client: deadRedis, log: logger, l1TtlMs: 60_000 });
    let runs = 0;
    const fn = async () => ++runs;

    const first = await cached("cache:test:l1-hit", 60, fn);
    const second = await cached("cache:test:l1-hit", 60, fn);

    // Redis is dead, so the only place the second value can come from is L1.
    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(runs).toBe(1);
  });

  test("an expired L1 entry re-runs fn (fake clock, zero sleeps)", async () => {
    const { logger } = captureLogger();
    let t = 0;
    const { cached } = createCache({
      client: deadRedis,
      log: logger,
      l1TtlMs: 1_000,
      now: () => t,
    });
    let runs = 0;
    const fn = async () => ++runs;

    await cached("cache:test:l1-expiry", 60, fn);
    t = 2_000; // past l1TtlMs
    const afterExpiry = await cached("cache:test:l1-expiry", 60, fn);

    expect(afterExpiry).toBe(2);
    expect(runs).toBe(2);
  });

  test("a rejected promise is not retained in L1", async () => {
    const { logger } = captureLogger();
    const { cached } = createCache({ client: deadRedis, log: logger, l1TtlMs: 60_000 });
    let runs = 0;

    await expect(
      cached("cache:test:l1-reject", 60, async () => {
        runs++;
        throw new Error("first fails");
      }),
    ).rejects.toThrow("first fails");
    const second = await cached("cache:test:l1-reject", 60, async () => {
      runs++;
      return "recovered";
    });

    expect(second).toBe("recovered");
    expect(runs).toBe(2);
  });

  test("at l1Max the oldest entry is evicted first (FIFO)", async () => {
    const { logger } = captureLogger();
    const { cached } = createCache({ client: deadRedis, log: logger, l1TtlMs: 60_000, l1Max: 2 });
    let runs = 0;
    const fn = async () => ++runs;

    await cached("cache:test:evict-a", 60, fn);
    await cached("cache:test:evict-b", 60, fn);
    // Inserting a third entry evicts the oldest (a).
    await cached("cache:test:evict-c", 60, fn);
    await cached("cache:test:evict-a", 60, fn); // miss: evicted
    await cached("cache:test:evict-c", 60, fn); // hit: still resident

    expect(runs).toBe(4);
  });

  test("invalidate purges exact and pattern L1 entries even when the Redis DEL fails", async () => {
    const { logger } = captureLogger();
    const { cached, invalidate } = createCache({
      client: deadRedis,
      log: logger,
      l1TtlMs: 60_000,
    });
    let runs = 0;
    const fn = async () => ++runs;

    // Different keys run in parallel: each dead-Redis command waits out the
    // reconnect backoff, and sequential awaits stack those delays up.
    await Promise.all([
      cached("cache:entity:demo:1", 60, fn),
      cached("cache:query:demo:list:abc", 60, fn),
    ]);
    await invalidate("cache:entity:demo:1", "cache:query:demo:*");
    await Promise.all([
      cached("cache:entity:demo:1", 60, fn),
      cached("cache:query:demo:list:abc", 60, fn),
    ]);

    // Both keys re-ran fn: the L1 purge happened even though Redis is down.
    expect(runs).toBe(4);
  }, 15_000);
});

describe("invalidate with Redis down", () => {
  test("swallows the error (mutations must not fail on a cache outage) and logs a warning", async () => {
    const { logger, lines } = captureLogger();
    const { invalidate } = createCache({ client: deadRedis, log: logger });

    await expect(invalidate("cache:test:exact", "cache:test:pattern:*")).resolves.toBeUndefined();

    const warned = lines.map((line) => JSON.parse(line)).find((entry) => entry.code);
    expect(warned?.code).toBe("CACHE_INVALIDATE_FAILED");
    expect(warned?.level).toBe(40); // pino warn
  });
});
