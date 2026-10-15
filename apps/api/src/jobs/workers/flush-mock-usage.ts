import type { Redis } from "ioredis";
import type { PgBoss, Queue, WorkOptions } from "pg-boss";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import type { UsageRepo } from "@/modules/usage/usage.repo";
import { parseUsageKey, USAGE_KEY_PREFIX } from "@/modules/usage/usage-counter";

// Moves the per-(mock, hour) Redis hashes written by the mock runtime
// (modules/usage/usage-counter.ts) into mock_usage_hourly.
//
// Per key: RENAME to a unique "…:flushing:<uuid>" name (new requests start a
// fresh hash, so nothing is counted twice or lost mid-flush), HGETALL,
// upsert-add, DEL. A crash between upsert and DEL leaves a flushing hash that
// the next run re-adds — the one double-count window, accepted for usage stats.

export const FLUSH_MOCK_USAGE_QUEUE = "flush-mock-usage";
// Every minute: "Requests 24h" lags by at most this.
export const FLUSH_MOCK_USAGE_CRON = "* * * * *";

// stately: at most one queued and one active tick, so a slow run never
// overlaps the next one or lets ticks pile up.
export const FLUSH_MOCK_USAGE_QUEUE_OPTIONS: Omit<Queue, "name"> = {
  policy: "stately",
  retryLimit: 0,
};

const SCAN_COUNT = 200;

export interface FlushMockUsageDeps {
  client: Pick<Redis, "scan" | "rename" | "hgetall" | "del">;
  usageRepo: Pick<UsageRepo, "addHourly">;
  log?: Logger;
}

function counter(value: string | undefined): number {
  const parsed = Number(value ?? "0");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function isNoSuchKey(error: unknown): boolean {
  return error instanceof Error && /no such key/i.test(error.message);
}

export function createFlushMockUsageHandler(deps: FlushMockUsageDeps) {
  const { client, usageRepo, log = defaultLogger } = deps;
  return async (): Promise<number> => {
    let cursor = "0";
    let flushed = 0;
    do {
      const [next, keys] = await client.scan(
        cursor,
        "MATCH",
        `${USAGE_KEY_PREFIX}*`,
        "COUNT",
        SCAN_COUNT,
      );
      cursor = next;
      for (const key of keys) {
        const parsed = parseUsageKey(key);
        if (!parsed) continue;
        let working = key;
        if (!parsed.flushing) {
          working = `${key}:flushing:${crypto.randomUUID()}`;
          try {
            await client.rename(key, working);
          } catch (error) {
            // SCAN may repeat a key we already moved.
            if (isNoSuchKey(error)) continue;
            throw error;
          }
        }
        // Empty = a flushing key this run already deleted (SCAN saw it later).
        const fields = await client.hgetall(working);
        if (Object.keys(fields).length > 0) {
          await usageRepo.addHourly({
            mockId: parsed.mockId,
            hour: new Date(parsed.hourEpochSeconds * 1000),
            requests: counter(fields.requests),
            clientErrors: counter(fields.client_errors),
            serverErrors: counter(fields.server_errors),
          });
          flushed += 1;
        }
        await client.del(working);
      }
    } while (cursor !== "0");
    log.info({ code: "MOCK_USAGE_FLUSHED", flushed }, "flushed mock usage counters");
    return flushed;
  };
}

export interface RegisterFlushMockUsageWorkerOptions {
  queueOptions?: Omit<Queue, "name">;
  workOptions?: WorkOptions;
}

export async function registerFlushMockUsageWorker(
  boss: PgBoss,
  deps: FlushMockUsageDeps,
  options: RegisterFlushMockUsageWorkerOptions = {},
): Promise<void> {
  const { queueOptions = FLUSH_MOCK_USAGE_QUEUE_OPTIONS, workOptions = {} } = options;
  await boss.createQueue(FLUSH_MOCK_USAGE_QUEUE, queueOptions);
  await boss.work(FLUSH_MOCK_USAGE_QUEUE, workOptions, createFlushMockUsageHandler(deps));
}

// schedule() upserts by queue name: every API pod and the worker process may
// re-assert it on boot.
export async function scheduleFlushMockUsage(boss: PgBoss): Promise<void> {
  await boss.schedule(FLUSH_MOCK_USAGE_QUEUE, FLUSH_MOCK_USAGE_CRON, {});
}
