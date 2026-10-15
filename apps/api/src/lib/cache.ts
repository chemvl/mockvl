import type { Redis } from "ioredis";
import { ConflictError } from "./errors";
import { logger as defaultLogger, type Logger } from "./logger";
import { withLock } from "./primitives";
import { redis as defaultRedis } from "./redis";

// Cache-aside utility (PLAN 8.5c). Redis is never a source of truth here:
// every read degrades to running `fn` when Redis is down, so the cache can
// slow a read path but never take it down. Values must be plain JSON data
// (schemas from packages/schemas where applicable).
//
// Two tiers sit in front of the origin:
//   L1 — an in-process promise micro-cache: concurrent callers of one key
//        share one promise (anti-stampede), and a *settled* promise lingers
//        for l1TtlMs so a burst of reads inside that window costs zero Redis
//        round-trips. With SWR on hot keys, origin load scales with
//        keys ÷ TTL instead of QPS.
//   L2 — Redis, shared across processes.
//
// Stale-while-revalidate ({ swr: true }): entries carry a logical expiry
// (staleAt) and live physically for 2× the TTL. A stale read returns the old
// value immediately and refreshes in the background under a cross-process
// lock — end users never pay origin latency on a warm key. The effective
// staleness budget is ttlS + l1TtlMs. Don't flip the flag per call site:
// entries written with swr but read without it serve as fresh up to 2×ttlS.
//
// L1 hits share object references across callers — treat cached values as
// frozen and never mutate a returned row.
//
// Key convention: cache:<area>:<name>:<discriminator>
//   e.g. cache:upstream:example:thing:123
//        cache:query:posts:list:<hash-of-params>
//        cache:entity:posts:<id>
//
// Invalidation rule: services own invalidation — mutation service methods
// (and Phase 9 registry hooks) call invalidate() for the keys they affect.
// Never invalidate from routes or repos.

export interface CreateCacheOptions {
  client?: Redis;
  log?: Logger;
  // How long a settled L1 promise keeps serving after it fulfills. 0 disables
  // the linger, leaving pure in-flight dedup. Deliberately tiny: L1 exists to
  // absorb bursts, not to hold data — freshness stays owned by Redis TTLs.
  l1TtlMs?: number;
  // L1 entry bound. Conservative because one entry can hold a full list page
  // (up to 100 rows).
  l1Max?: number;
  // Injectable clock, purely for deterministic tests (no sleeps).
  now?: () => number;
}

export interface CachedOptions {
  // Cross-process fill dedup via the 8.5d lock, off by default: while one
  // process fills a key, a contending process computes without caching
  // instead of stampeding the origin with concurrent fills.
  lock?: boolean;
  // Stale-while-revalidate, off by default: serve a logically-expired entry
  // immediately and refresh it in the background. Orthogonal to `lock`
  // (lock = cold-fill dedup; swr = warm refresh policy).
  swr?: boolean;
}

// A fill should never take this long; if it does, the lock expires and the
// next reader may fill concurrently — a stampede of two, not a failure.
const FILL_LOCK_TTL_MS = 10_000;
const SCAN_BATCH = 100;
const DEFAULT_L1_TTL_MS = 200;
const DEFAULT_L1_MAX = 512;
// Sentinel expiry for a still-pending L1 promise: dedup must outlive even a
// slow fill, so pending entries never expire by time.
const PENDING = Number.POSITIVE_INFINITY;

interface StoredValue<T> {
  data: T;
  // Present only on SWR-written entries: logical expiry in epoch ms. Old-format
  // entries (no staleAt) parse as fresh until physical expiry.
  staleAt?: number;
}

interface L1Entry {
  promise: Promise<unknown>;
  expiresAt: number;
}

// `*` is the only glob character; everything else matches literally.
function globToRegExp(pattern: string): RegExp {
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? ".*" : `\\${ch}`));
  return new RegExp(`^${source}$`);
}

export function createCache(options: CreateCacheOptions = {}) {
  const {
    client = defaultRedis,
    log = defaultLogger,
    l1TtlMs = DEFAULT_L1_TTL_MS,
    l1Max = DEFAULT_L1_MAX,
    now = Date.now,
  } = options;
  // L1: in-process promise micro-cache (see header). Note the deliberate
  // semantic with Redis down: a successful fn result still lingers here for
  // l1TtlMs, so the micro-cache keeps absorbing bursts through an outage.
  const l1 = new Map<string, L1Entry>();
  // In-process refresh dedup: N concurrent stale reads fire one lock attempt,
  // not N Redis round-trips. Values are the pending refresh promises so tests
  // can await them (see flushRefreshes).
  const refreshing = new Map<string, Promise<void>>();
  // Edge-triggered outage logging (same pattern as the rate-limit store):
  // during a sustained outage every request would otherwise warn.
  let cacheDown = false;

  function reportError(code: string, err: unknown, key?: string): void {
    if (cacheDown) return;
    cacheDown = true;
    log.warn({ err, code, key }, "cache store unavailable; serving from origin");
  }

  function reportOk(): void {
    if (!cacheDown) return;
    cacheDown = false;
    log.info("cache store recovered");
  }

  function isStale(stored: StoredValue<unknown>): boolean {
    // Never touch .data here — undefined (a cached negative lookup)
    // round-trips as an absent property, not a marker.
    return typeof stored.staleAt === "number" && now() >= stored.staleAt;
  }

  function evictForInsert(): void {
    if (l1.size < l1Max) return;
    const nowMs = now();
    for (const [key, entry] of l1) {
      if (entry.expiresAt <= nowMs) l1.delete(key);
    }
    // Still full: drop oldest-first (Map insertion order — FIFO, not true
    // LRU). Evicting a pending entry only loses dedup; its callers keep
    // their promise.
    while (l1.size >= l1Max) {
      const oldest = l1.keys().next().value;
      if (oldest === undefined) break;
      l1.delete(oldest);
    }
  }

  // Post-refresh L1 replacement so this process stops serving the stale value
  // for another l1TtlMs. Never clobbers a pending entry — a fill racing in
  // after invalidate() is fresher than this refresh.
  function setL1Fresh(key: string, value: unknown): void {
    if (l1TtlMs <= 0) return;
    const existing = l1.get(key);
    if (existing && existing.expiresAt === PENDING) return;
    evictForInsert();
    l1.set(key, { promise: Promise.resolve(value), expiresAt: now() + l1TtlMs });
  }

  async function writeValue(
    key: string,
    ttlS: number,
    value: unknown,
    swr: boolean,
  ): Promise<void> {
    // Wrapped like primitives' StoredResult: JSON.stringify(undefined) is the
    // VALUE undefined (not a string), which ioredis coerces to "" — a
    // poisoned entry that parses as a cache failure on every later read.
    // {data: undefined} serializes to "{}" and round-trips cleanly.
    const stored: StoredValue<unknown> = swr
      ? { data: value, staleAt: now() + ttlS * 1000 }
      : { data: value };
    let payload: string;
    try {
      payload = JSON.stringify(stored);
    } catch (err) {
      // A caller-side bug (BigInt, circular value), not a Redis outage —
      // distinct code, and not edge-triggered: every occurrence is signal.
      log.warn({ err, code: "CACHE_SERIALIZE_FAILED", key }, "cache value not serializable");
      return;
    }
    try {
      // SWR entries live physically for 2× the TTL so a stale value stays
      // servable while a refresh runs.
      await client.set(key, payload, "EX", swr ? ttlS * 2 : ttlS);
      reportOk();
    } catch (err) {
      reportError("CACHE_WRITE_FAILED", err, key);
    }
  }

  async function fillUnderLock<T>(
    key: string,
    ttlS: number,
    fn: () => Promise<T>,
    swr: boolean,
  ): Promise<T> {
    let fnStarted = false;
    try {
      return await withLock(
        `cachefill:${key}`,
        FILL_LOCK_TTL_MS,
        async () => {
          // Double-check under the lock: the previous holder may have filled
          // the key while we waited to acquire. Staleness-aware — a
          // stale-but-present SWR entry must refresh, not early-return.
          try {
            const hit = await client.get(key);
            if (hit !== null) {
              const stored = JSON.parse(hit) as StoredValue<T>;
              if (!(swr && isStale(stored))) return stored.data;
            }
          } catch {
            // Recheck is best-effort; the read path already warned.
          }
          fnStarted = true;
          const value = await fn();
          await writeValue(key, ttlS, value, swr);
          return value;
        },
        { client, log },
      );
    } catch (err) {
      // fn's own failure must propagate — never silently run it twice.
      if (fnStarted) throw err;
      // Lock contention (another process is filling) or lock store failure:
      // compute without caching rather than failing the read.
      if (!(err instanceof ConflictError)) reportError("CACHE_LOCK_FAILED", err, key);
      return fn();
    }
  }

  // Background SWR refresh. Never rejects; the caller already got the stale
  // value, so failures degrade to "keep serving stale until physical expiry".
  async function refreshValue(
    key: string,
    ttlS: number,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    let fnStarted = false;
    try {
      await withLock(
        `cachefill:${key}`,
        FILL_LOCK_TTL_MS,
        async () => {
          // Re-check staleness under the lock: another process may have
          // refreshed while we acquired.
          try {
            const hit = await client.get(key);
            if (hit !== null && !isStale(JSON.parse(hit) as StoredValue<unknown>)) return;
          } catch {
            // Best-effort recheck; refreshing an already-fresh key is harmless.
          }
          fnStarted = true;
          const value = await fn();
          await writeValue(key, ttlS, value, true);
          setL1Fresh(key, value);
        },
        { client, log },
      );
    } catch (err) {
      // Another process holds the refresh lock — its fill wins.
      if (err instanceof ConflictError) return;
      if (fnStarted) {
        // The origin failed, not Redis: not edge-triggered — every occurrence
        // is signal. Stale keeps being served until physical expiry.
        log.warn(
          { err, code: "CACHE_REFRESH_FAILED", key },
          "background refresh failed; serving stale",
        );
        return;
      }
      // Lock store failure (Redis down) — edge-triggered like the read path.
      reportError("CACHE_LOCK_FAILED", err, key);
    }
  }

  function scheduleRefresh(key: string, ttlS: number, fn: () => Promise<unknown>): void {
    if (refreshing.has(key)) return;
    // .catch attached synchronously: Bun surfaces unhandled rejections (and
    // bun test fails on them). refreshValue handles its own errors, so this
    // is a backstop.
    const task = refreshValue(key, ttlS, fn)
      .catch((err: unknown) => {
        log.warn({ err, code: "CACHE_REFRESH_FAILED", key }, "unexpected refresh failure");
      })
      .finally(() => {
        refreshing.delete(key);
      });
    refreshing.set(key, task);
  }

  async function readThrough<T>(
    key: string,
    ttlS: number,
    fn: () => Promise<T>,
    opts?: CachedOptions,
  ): Promise<T> {
    const swr = opts?.swr === true;
    try {
      const hit = await client.get(key);
      reportOk();
      if (hit !== null) {
        const stored = JSON.parse(hit) as StoredValue<T>;
        if (!(swr && isStale(stored))) return stored.data;
        // SWR: serve the stale value now, refresh in the background.
        scheduleRefresh(key, ttlS, fn);
        return stored.data;
      }
    } catch (err) {
      // Redis (or a corrupt entry) failed the read — serve from origin and
      // skip the write, which would only add latency against a dead store.
      reportError("CACHE_READ_FAILED", err, key);
      return fn();
    }
    if (opts?.lock) return fillUnderLock(key, ttlS, fn, swr);
    const value = await fn();
    await writeValue(key, ttlS, value, swr);
    return value;
  }

  function cached<T>(
    key: string,
    ttlS: number,
    fn: () => Promise<T>,
    opts?: CachedOptions,
  ): Promise<T> {
    const existing = l1.get(key);
    if (existing && existing.expiresAt > now()) return existing.promise as Promise<T>;
    const promise = readThrough(key, ttlS, fn, opts);
    const entry: L1Entry = { promise, expiresAt: PENDING };
    // Identity-checked settlement: only touch the entry if the map still
    // holds *this* promise — an unconditional delete would race with
    // invalidate() + re-fill and evict the newer entry.
    promise.then(
      () => {
        if (l1.get(key) !== entry) return;
        if (l1TtlMs > 0) entry.expiresAt = now() + l1TtlMs;
        else l1.delete(key);
      },
      () => {
        // Rejections are never cached: the next caller retries.
        if (l1.get(key) === entry) l1.delete(key);
      },
    );
    evictForInsert();
    l1.set(key, entry);
    return promise;
  }

  async function invalidate(...keysOrPatterns: string[]): Promise<void> {
    // A `*` anywhere marks the entry as a glob pattern. Keys must therefore
    // never embed raw user input in their discriminator (use ids or a hash,
    // per the key convention) — a literal `*` would turn an exact delete
    // into a pattern sweep.
    const exact = keysOrPatterns.filter((entry) => !entry.includes("*"));
    const patterns = keysOrPatterns.filter((entry) => entry.includes("*"));

    // L1 purge, synchronously before any await. Guarantee: reads *starting*
    // after `await invalidate()` are fresh in this process; concurrent
    // in-flight reads and other processes are bounded by TTL/l1TtlMs.
    for (const key of exact) l1.delete(key);
    for (const pattern of patterns) {
      const re = globToRegExp(pattern);
      for (const key of l1.keys()) {
        if (re.test(key)) l1.delete(key);
      }
    }

    try {
      if (exact.length > 0) await client.del(...exact);
      for (const pattern of patterns) {
        // SCAN, never KEYS: KEYS blocks Redis for the whole keyspace walk.
        let cursor = "0";
        do {
          const [next, matches] = await client.scan(cursor, "MATCH", pattern, "COUNT", SCAN_BATCH);
          cursor = next;
          if (matches.length > 0) await client.del(...matches);
        } while (cursor !== "0");
      }
      reportOk();
    } catch (err) {
      // Swallow: the mutation already committed, so failing it now would
      // trade bounded staleness (the TTL) for a spurious 5xx on the write.
      reportError("CACHE_INVALIDATE_FAILED", err);
    }
  }

  // Test hook: awaits pending background refreshes so suites can assert on
  // refreshed state (and close their Redis client without an orphaned refresh
  // throwing "Connection is closed" after afterAll).
  async function flushRefreshes(): Promise<void> {
    while (refreshing.size > 0) {
      await Promise.all([...refreshing.values()]);
    }
  }

  return { cached, invalidate, flushRefreshes };
}

export type Cache = ReturnType<typeof createCache>;
export type CachedFn = Cache["cached"];
export type InvalidateFn = Cache["invalidate"];

// Default instance on the shared Redis client — what production code imports.
export const { cached, invalidate } = createCache();
