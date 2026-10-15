import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { createCache } from "@/lib/cache";
import { createLogger } from "@/lib/logger";
import { closeRedis, createRedis } from "@/lib/redis";

// Integration tests — they require the compose Redis from docker-compose.yml
// to be up (docker compose up -d).

const client = createRedis(String(process.env.REDIS_URL));
// l1TtlMs: 0 — these tests pin Redis behavior; the L1 tier would otherwise
// absorb the second read of most of them (L1 coverage lives in unit tests).
const { cached, invalidate } = createCache({ client, l1TtlMs: 0 });

// Redis keys persist between runs, so every test key is unique per run.
const runId = crypto.randomUUID();
const key = (name: string) => `cache:test:${runId}:${name}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(async () => {
  await closeRedis(client);
});

describe("cached", () => {
  test("miss runs fn, stores the value under the exact key with the TTL, and returns it", async () => {
    const missKey = key("miss");

    const value = await cached(missKey, 60, async () => ({ id: "t-1", title: "cached thing" }));

    expect(value).toEqual({ id: "t-1", title: "cached thing" });
    // Stored wrapped (like idempotent's StoredResult) so `undefined` and the
    // raw value can never be confused with a corrupt/empty entry.
    expect(JSON.parse(String(await client.get(missKey)))).toEqual({
      data: { id: "t-1", title: "cached thing" },
    });
    const pttl = await client.pttl(missKey);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(60_000);
  });

  test("hit returns the stored value without running fn", async () => {
    const hitKey = key("hit");
    let runs = 0;
    const fn = async () => {
      runs++;
      return { n: runs };
    };

    const first = await cached(hitKey, 60, fn);
    const second = await cached(hitKey, 60, fn);

    expect(first).toEqual({ n: 1 });
    expect(second).toEqual({ n: 1 });
    expect(runs).toBe(1);
  });

  test("an fn returning undefined is cached, not silently re-fetched every call", async () => {
    // Regression: JSON.stringify(undefined) is undefined (not a string), which
    // ioredis coerced to "" — poisoning the key so every read re-ran fn and
    // flapped the outage logger. Repos here return undefined for "not found",
    // so this is the documented cached(() => repo.findById(id)) shape.
    const undefKey = key("undefined-value");
    let runs = 0;
    const fn = async () => {
      runs++;
      return undefined;
    };

    const first = await cached(undefKey, 60, fn);
    const second = await cached(undefKey, 60, fn);

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(runs).toBe(1);
    expect(await client.get(undefKey)).toBe("{}"); // {data: undefined} serializes to {}
  });

  test("an unserializable value is not cached, logs its own code, and still returns", async () => {
    const lines: string[] = [];
    const log = createLogger({
      level: "debug",
      destination: {
        write(msg: string) {
          lines.push(msg);
        },
      },
    });
    const local = createCache({ client, log });
    const badKey = key("unserializable");

    const value = await local.cached(badKey, 60, async () => ({ n: BigInt(1) }));

    expect(value).toEqual({ n: BigInt(1) });
    expect(await client.get(badKey)).toBeNull();
    const warned = lines.map((line) => JSON.parse(line)).find((entry) => entry.code);
    // A caller-side serialization bug, not a Redis outage — distinct code.
    expect(warned?.code).toBe("CACHE_SERIALIZE_FAILED");
    expect(warned?.level).toBe(40);
  });

  test("an expired entry is a miss: fn runs again after the TTL", async () => {
    const expiryKey = key("expiry");
    let runs = 0;
    const fn = async () => ++runs;

    // Generous margin over the 1s TTL: a ~100ms margin flaked once the full
    // suite grew enough to slow timers and Redis round-trips under load.
    await cached(expiryKey, 1, fn);
    await sleep(1_500);
    const afterExpiry = await cached(expiryKey, 1, fn);

    expect(afterExpiry).toBe(2);
    expect(runs).toBe(2);
  });

  test("cross-process fill dedup via lock (opt-in): an uncontended fill stores normally", async () => {
    const lockKey = key("locked-fill");

    const value = await cached(lockKey, 60, async () => "filled-under-lock", { lock: true });

    expect(value).toBe("filled-under-lock");
    expect(JSON.parse(String(await client.get(lockKey)))).toEqual({ data: "filled-under-lock" });
  });

  test("cross-process fill dedup via lock: a contending process computes without caching", async () => {
    const contestedKey = key("locked-contested");
    // Two createCache instances = two processes (separate in-flight maps).
    const other = createCache({ client });
    let slowRuns = 0;
    let fastRuns = 0;

    const slow = cached(
      contestedKey,
      60,
      async () => {
        slowRuns++;
        await sleep(300);
        return "slow";
      },
      { lock: true },
    );
    await sleep(50);
    // The fill lock is held — the second process must still get an answer.
    const fast = await other.cached(
      contestedKey,
      60,
      async () => {
        fastRuns++;
        return "fast";
      },
      { lock: true },
    );

    expect(fast).toBe("fast");
    await expect(slow).resolves.toBe("slow");
    expect(slowRuns).toBe(1);
    expect(fastRuns).toBe(1);
  });
});

describe("invalidate", () => {
  test("deletes exact keys so the next read runs fn again", async () => {
    const exactKey = key("exact");
    let runs = 0;
    const fn = async () => ++runs;

    await cached(exactKey, 60, fn);
    await invalidate(exactKey);
    const afterInvalidate = await cached(exactKey, 60, fn);

    expect(afterInvalidate).toBe(2);
  });

  test("deletes pattern matches via SCAN and leaves other keys alone", async () => {
    const listA = key("query:posts:list:a");
    const listB = key("query:posts:list:b");
    const unrelated = key("query:users:list:a");
    await cached(listA, 60, async () => "a");
    await cached(listB, 60, async () => "b");
    await cached(unrelated, 60, async () => "u");

    await invalidate(`${key("query:posts:list:")}*`);

    expect(await client.get(listA)).toBeNull();
    expect(await client.get(listB)).toBeNull();
    expect(JSON.parse(String(await client.get(unrelated)))).toEqual({ data: "u" });
  });
});

describe("cached with stale-while-revalidate", () => {
  // The injected clock controls *logical* staleness (staleAt comparisons);
  // physical expiry stays on real Redis time, so entries outlive the whole
  // test. Zero sleeps around staleness.
  let t = 1_000_000_000_000;
  const swrCache = createCache({ client, l1TtlMs: 0, now: () => t });

  afterAll(async () => {
    // Orphaned background refreshes would throw once the client closes.
    await swrCache.flushRefreshes();
  });

  test("a cold miss with swr writes staleAt and a 2× physical TTL", async () => {
    const coldKey = key("swr-cold");

    const value = await swrCache.cached(coldKey, 30, async () => "v1", { swr: true });

    expect(value).toBe("v1");
    const stored = JSON.parse(String(await client.get(coldKey)));
    expect(stored.data).toBe("v1");
    expect(stored.staleAt).toBe(t + 30_000);
    const pttl = await client.pttl(coldKey);
    expect(pttl).toBeGreaterThan(30_000);
    expect(pttl).toBeLessThanOrEqual(60_000);
  });

  test("a cold miss with {swr, lock} also writes the SWR format", async () => {
    const lockedKey = key("swr-cold-locked");

    const value = await swrCache.cached(lockedKey, 30, async () => "v1", {
      swr: true,
      lock: true,
    });

    expect(value).toBe("v1");
    const stored = JSON.parse(String(await client.get(lockedKey)));
    expect(stored.staleAt).toBe(t + 30_000);
    const pttl = await client.pttl(lockedKey);
    expect(pttl).toBeGreaterThan(30_000);
    expect(pttl).toBeLessThanOrEqual(60_000);
  });

  test("a stale read returns the old value immediately and refreshes in the background", async () => {
    const staleKey = key("swr-stale");
    let runs = 0;
    const fn = async () => ++runs;

    await swrCache.cached(staleKey, 10, fn, { swr: true }); // staleAt = t + 10s
    t += 11_000; // logically stale, physically alive (20s real TTL)
    const served = await swrCache.cached(staleKey, 10, fn, { swr: true });
    expect(served).toBe(1); // the stale value, not the refreshed one
    await swrCache.flushRefreshes();

    expect(runs).toBe(2); // exactly one background refresh ran
    const stored = JSON.parse(String(await client.get(staleKey)));
    expect(stored.data).toBe(2);
    expect(stored.staleAt).toBe(t + 10_000); // re-stamped by the refresh
    const next = await swrCache.cached(staleKey, 10, fn, { swr: true });
    expect(next).toBe(2);
    expect(runs).toBe(2);
  });

  test("concurrent stale reads fire one refresh (in-process dedup)", async () => {
    const dedupKey = key("swr-dedup");
    let runs = 0;
    const slowFn = async () => {
      runs++;
      await sleep(150);
      return runs;
    };

    await swrCache.cached(dedupKey, 10, slowFn, { swr: true });
    t += 11_000;
    // Sequential stale reads while the first refresh is still running: with
    // l1TtlMs 0 each read hits Redis, sees stale, and must dedup on the
    // refreshing set, not fire its own lock attempt.
    const first = await swrCache.cached(dedupKey, 10, slowFn, { swr: true });
    const second = await swrCache.cached(dedupKey, 10, slowFn, { swr: true });
    await swrCache.flushRefreshes();

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(runs).toBe(2); // initial fill + exactly one refresh
  });

  test("cross-instance stale reads dedup via the fill lock", async () => {
    const crossKey = key("swr-cross");
    const other = createCache({ client, l1TtlMs: 0, now: () => t });
    let runs = 0;
    const slowFn = async () => {
      runs++;
      await sleep(150);
      return runs;
    };

    await swrCache.cached(crossKey, 10, slowFn, { swr: true });
    t += 11_000;
    // Two instances = two processes (separate refreshing sets). Both see the
    // stale entry; the NX lock (or the staleness re-check under it) must
    // collapse the two refreshes into one.
    const [a, b] = await Promise.all([
      swrCache.cached(crossKey, 10, slowFn, { swr: true }),
      other.cached(crossKey, 10, slowFn, { swr: true }),
    ]);
    await swrCache.flushRefreshes();
    await other.flushRefreshes();

    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(runs).toBe(2); // initial fill + exactly one refresh across both
  });

  test("a failing refresh keeps serving the stale value until physical expiry", async () => {
    const lines: string[] = [];
    const log = createLogger({
      level: "debug",
      destination: {
        write(msg: string) {
          lines.push(msg);
        },
      },
    });
    const local = createCache({ client, log, l1TtlMs: 0, now: () => t });
    const failKey = key("swr-refresh-fail");
    const failingFn = async (): Promise<string> => {
      throw new Error("origin down");
    };

    await local.cached(failKey, 10, async () => "v1", { swr: true });
    t += 11_000;
    const served = await local.cached(failKey, 10, failingFn, { swr: true });
    await local.flushRefreshes();
    const afterFailure = await local.cached(failKey, 10, failingFn, { swr: true });
    await local.flushRefreshes();

    expect(served).toBe("v1");
    expect(afterFailure).toBe("v1");
    const warned = lines
      .map((line) => JSON.parse(line))
      .find((entry) => entry.code === "CACHE_REFRESH_FAILED");
    expect(warned?.level).toBe(40);
  });

  test("an old-format entry (no staleAt) read with swr is treated as fresh", async () => {
    const oldKey = key("swr-old-format");
    await client.set(oldKey, JSON.stringify({ data: "old" }), "EX", 60);
    let runs = 0;

    const value = await swrCache.cached<string | number>(oldKey, 10, async () => ++runs, {
      swr: true,
    });

    expect(value).toBe("old");
    expect(runs).toBe(0);
  });
});

describe("service-owned invalidation (PLAN 8.5c acceptance)", () => {
  // Minimal stand-in for a real module: reads go through cached(), the
  // mutation updates the source of truth and then invalidates — the pattern
  // Phase 9 registry hooks will follow. Services own invalidation; routes
  // and repos never call invalidate().
  function createDemoService() {
    const table = new Map<string, { id: string; title: string }>([
      ["p-1", { id: "p-1", title: "original title" }],
    ]);
    const cacheKey = (id: string) => key(`query:posts:byId:${id}`);
    return {
      async getPost(id: string) {
        return cached(cacheKey(id), 60, async () => table.get(id) ?? null);
      },
      async updatePost(id: string, title: string) {
        const existing = table.get(id);
        if (!existing) throw new Error("not found");
        table.set(id, { ...existing, title });
        await invalidate(cacheKey(id));
      },
    };
  }

  test("a mutated record is not served stale after the service invalidates", async () => {
    const service = createDemoService();

    const before = await service.getPost("p-1");
    await service.updatePost("p-1", "updated title");
    const after = await service.getPost("p-1");

    expect(before?.title).toBe("original title");
    expect(after?.title).toBe("updated title");
  });
});
