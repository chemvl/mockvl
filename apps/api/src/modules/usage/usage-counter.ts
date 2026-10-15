// Hot-path request counting for hosted mocks. Each response adds to a Redis
// hash per (mock, UTC hour); jobs/workers/flush-mock-usage.ts moves the hashes
// into mock_usage_hourly every minute. Counting is best-effort: a Redis outage
// loses counts but never fails a mock response.
import type { Redis } from "ioredis";
import { logger as defaultLogger, type Logger } from "@/lib/logger";

export const USAGE_KEY_PREFIX = "usage:mock:";
// Outlives any realistic flush outage; orphaned hashes still expire.
export const USAGE_KEY_TTL_S = 2 * 24 * 60 * 60;

const HOUR_MS = 60 * 60 * 1000;
const USAGE_KEY = /^usage:mock:([0-9a-f-]{36}):(\d+)(:flushing:[0-9a-f-]{36})?$/;

export function hourEpochSeconds(at: Date): number {
  return (Math.floor(at.getTime() / HOUR_MS) * HOUR_MS) / 1000;
}

export function usageKey(mockId: string, at: Date): string {
  return `${USAGE_KEY_PREFIX}${mockId}:${hourEpochSeconds(at)}`;
}

export function parseUsageKey(
  key: string,
): { mockId: string; hourEpochSeconds: number; flushing: boolean } | null {
  const match = USAGE_KEY.exec(key);
  if (!match?.[1] || !match[2]) return null;
  return { mockId: match[1], hourEpochSeconds: Number(match[2]), flushing: match[3] !== undefined };
}

export interface UsageStore {
  increment(key: string, fields: Record<string, number>, ttlSeconds: number): Promise<void>;
}

// HINCRBY each field + EXPIRE in one MULTI round trip.
export function createRedisUsageStore(client: Redis): UsageStore {
  return {
    async increment(key, fields, ttlSeconds) {
      const tx = client.multi();
      for (const [field, amount] of Object.entries(fields)) tx.hincrby(key, field, amount);
      tx.expire(key, ttlSeconds);
      const results = await tx.exec();
      const failure = results?.find(([error]) => error !== null)?.[0];
      if (failure) throw failure;
    },
  };
}

export interface UsageCounter {
  // Never rejects.
  record(mockId: string, status: number): Promise<void>;
}

export interface UsageCounterDeps {
  store: UsageStore;
  now?: () => Date;
  log?: Logger;
}

export function createUsageCounter(deps: UsageCounterDeps): UsageCounter {
  const { store, now = () => new Date(), log = defaultLogger } = deps;
  return {
    async record(mockId: string, status: number): Promise<void> {
      const fields: Record<string, number> = { requests: 1 };
      if (status >= 400 && status < 500) fields.client_errors = 1;
      else if (status >= 500) fields.server_errors = 1;
      try {
        await store.increment(usageKey(mockId, now()), fields, USAGE_KEY_TTL_S);
      } catch (err) {
        log.warn({ err, code: "MOCK_USAGE_RECORD_FAILED", mockId }, "mock usage not recorded");
      }
    },
  };
}
