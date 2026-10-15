import type { ClientRateLimitInfo, Store } from "hono-rate-limiter";
import type { Redis } from "ioredis";
import type { AppEnv } from "@/lib/context";
import { RateLimitError } from "@/lib/errors";
import { logger as defaultLogger, type Logger } from "@/lib/logger";

export interface RedisRateLimitStoreOptions {
  client: Redis;
  // One namespace per limiter (e.g. "rl:global:") so tiers never share
  // counters; every instance pointed at the same Redis shares the limit.
  prefix: string;
  // Outage stance (PLAN 8.5): true = serve traffic and log, false = 429.
  failOpen: boolean;
  log?: Logger;
}

const DEFAULT_WINDOW_MS = 60_000;

// Fixed-window counter, the deliberate choice from PLAN 8.5b: INCR creates or
// advances the counter, PEXPIRE NX starts the window only on the first hit,
// PTTL reports how long the window has left. Atomic via MULTI. Do not upgrade
// to a sliding-window log unless a test demonstrates the need.
export function createRedisRateLimitStore(options: RedisRateLimitStoreOptions): Store<AppEnv> {
  const { client, prefix, failOpen, log = defaultLogger } = options;
  let windowMs = DEFAULT_WINDOW_MS;
  // Edge-triggered outage logging: during a sustained outage every request
  // hits the catch below, and one line per request would flood the logs
  // exactly when on-call needs signal.
  let storeDown = false;

  async function fixedWindowIncrement(key: string): Promise<ClientRateLimitInfo> {
    const redisKey = prefix + key;
    const results = await client
      .multi()
      .incr(redisKey)
      .pexpire(redisKey, windowMs, "NX")
      .pttl(redisKey)
      .exec();
    if (!results) throw new Error("redis MULTI aborted");
    const failure = results.find(([err]) => err !== null)?.[0];
    if (failure) throw failure;

    const totalHits = Number(results[0]?.[1]);
    const pttlMs = Number(results[2]?.[1]);
    return {
      totalHits,
      // PTTL < 0 means "no expiry" — unreachable after PEXPIRE NX above, but
      // fall back to a full window rather than reporting a past reset time.
      resetTime: new Date(Date.now() + (pttlMs > 0 ? pttlMs : windowMs)),
    };
  }

  return {
    prefix,
    // Counters live in Redis: keys incremented in one instance are shared
    // with every other instance (disables the library's local-store warning).
    localKeys: false,
    init(config: { windowMs: number }): void {
      windowMs = config.windowMs;
    },
    async increment(key: string): Promise<ClientRateLimitInfo> {
      try {
        const info = await fixedWindowIncrement(key);
        if (storeDown) {
          storeDown = false;
          log.info({ code: "RATE_LIMIT_STORE_RECOVERED", prefix }, "rate limit store recovered");
        }
        return info;
      } catch (err) {
        if (!storeDown) {
          storeDown = true;
          log.error(
            { err, code: "RATE_LIMIT_STORE_DOWN", failOpen, prefix },
            "rate limit store unavailable",
          );
        }
        if (!failOpen) throw new RateLimitError();
        return { totalHits: 0 };
      }
    },
    async decrement(key: string): Promise<void> {
      try {
        // PEXPIRE NX rides along because DECR on a missing key (window
        // already rolled over) would otherwise create a counter with no TTL
        // that never expires.
        await client
          .multi()
          .decr(prefix + key)
          .pexpire(prefix + key, windowMs, "NX")
          .exec();
      } catch (err) {
        // Never let bookkeeping take down a request path.
        log.warn({ err }, "rate limit decrement failed");
      }
    },
    async resetKey(key: string): Promise<void> {
      try {
        await client.del(prefix + key);
      } catch (err) {
        log.warn({ err }, "rate limit resetKey failed");
      }
    },
  };
}
