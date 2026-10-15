import type { Redis } from "ioredis";
import { ConflictError } from "./errors";
import { logger as defaultLogger, type Logger } from "./logger";
import { redis as defaultRedis } from "./redis";

// Distributed coordination primitives (PLAN 8.5d). Unlike the cache, these
// FAIL CLOSED: if Redis cannot confirm the lock/idempotency state, the
// operation is rejected rather than run unguarded. No production call sites
// yet — they exist for Phase 9 registry hooks and future webhook/payment
// endpoints (usage recipes in docs/QUICKSTART.md).

export interface PrimitiveOptions {
  client?: Redis;
  log?: Logger;
}

// Release only the lock we acquired: another process may hold the key by now
// (our TTL expired mid-fn), so compare the token before deleting.
const RELEASE_IF_TOKEN_MATCHES = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  options: PrimitiveOptions = {},
): Promise<T> {
  const { client = defaultRedis, log = defaultLogger } = options;
  const lockKey = `lock:${key}`;
  const token = crypto.randomUUID();

  let acquired: "OK" | null;
  try {
    acquired = await client.set(lockKey, token, "PX", ttlMs, "NX");
  } catch (err) {
    log.error({ err, code: "LOCK_STORE_DOWN", key: lockKey }, "lock store unavailable");
    throw err;
  }
  if (acquired !== "OK") throw new ConflictError("LOCKED", { key });

  try {
    return await fn();
  } finally {
    try {
      await client.eval(RELEASE_IF_TOKEN_MATCHES, 1, lockKey, token);
    } catch (err) {
      // The TTL frees the lock eventually — never mask fn's outcome for this.
      log.warn({ err, key: lockKey }, "lock release failed; TTL will expire it");
    }
  }
}

const PENDING_MARKER = "pending";

// Results are wrapped so the stored JSON can never collide with the pending
// marker and `undefined` round-trips as `{}` instead of breaking JSON.parse.
interface StoredResult<T> {
  data: T;
}

export async function idempotent<T>(
  key: string,
  ttlS: number,
  fn: () => Promise<T>,
  options: PrimitiveOptions = {},
): Promise<T> {
  const { client = defaultRedis, log = defaultLogger } = options;
  const idemKey = `idem:${key}`;

  let claimed: "OK" | null;
  try {
    claimed = await client.set(idemKey, PENDING_MARKER, "EX", ttlS, "NX");
  } catch (err) {
    log.error(
      { err, code: "IDEMPOTENCY_STORE_DOWN", key: idemKey },
      "idempotency store unavailable",
    );
    throw err;
  }

  if (claimed !== "OK") {
    // Someone got here first: replay their stored result, or 409 while the
    // original run is still pending (or just expired — caller retries).
    const stored = await client.get(idemKey);
    if (stored === null || stored === PENDING_MARKER) {
      throw new ConflictError("Idempotent operation already in progress", { key });
    }
    return (JSON.parse(stored) as StoredResult<T>).data;
  }

  let result: T;
  try {
    result = await fn();
  } catch (err) {
    // Clear the marker so the caller can retry; if the DEL fails, duplicates
    // are rejected until the TTL expires — the fail-closed direction.
    await client.del(idemKey).catch((delErr: unknown) => {
      log.error({ err: delErr, key: idemKey }, "failed to clear pending idempotency marker");
    });
    throw err;
  }

  try {
    await client.set(
      idemKey,
      JSON.stringify({ data: result } satisfies StoredResult<T>),
      "EX",
      ttlS,
    );
  } catch (err) {
    // fn already ran, so return its result — but replays now 409 as
    // "pending" until the TTL expires instead of being served the result.
    log.error({ err, key: idemKey }, "failed to store idempotent result");
  }
  return result;
}
