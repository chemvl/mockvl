import { Redis } from "ioredis";
import { env } from "@/config/env";
import { logger } from "./logger";

// Redis is a cache/coordination layer, never a source of truth (PLAN Phase
// 8.5). Callers must degrade gracefully when it is down, so the client is
// tuned for fast errors over patient retries.
export function createRedis(url: string): Redis {
  const client = new Redis(url, {
    // Connect on first command, not at import — mirrors the lazy PG pool.
    lazyConnect: true,
    // One retry per command: an outage surfaces as a fast error, not a hang.
    maxRetriesPerRequest: 1,
    // Fail readiness checks fast instead of the driver's patient default.
    connectTimeout: 5_000,
    // Cap the reconnect backoff: commands wait for the next reconnect
    // attempt, so the default (up to 2s) makes failures slower the longer
    // an outage lasts.
    retryStrategy: (times) => Math.min(times * 50, 500),
  });
  // ioredis emits "error" for connection failures (including every background
  // reconnect); without a listener each one prints an unhandled-error notice.
  // Log only when the error changes — a sustained outage repeats the same
  // ECONNREFUSED several times a second.
  let lastLoggedError: string | undefined;
  client.on("error", (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message === lastLoggedError) return;
    lastLoggedError = message;
    logger.warn({ err }, "redis client error");
  });
  client.on("ready", () => {
    if (lastLoggedError === undefined) return;
    lastLoggedError = undefined;
    logger.info("redis connection restored");
  });
  return client;
}

export const redis = createRedis(env.REDIS_URL);

export async function pingRedis(client: Redis = redis): Promise<void> {
  await client.ping();
}

export async function closeRedis(client: Redis = redis): Promise<void> {
  // "wait" = lazy client that never connected (quit() would connect first
  // just to say goodbye); "end" = already closed. Drop those synchronously.
  if (client.status === "wait" || client.status === "end") {
    client.disconnect();
    return;
  }
  try {
    // Graceful: QUIT waits for pending replies before the socket closes.
    await client.quit();
  } catch {
    // Unreachable server — sever the connection instead of waiting on QUIT.
    client.disconnect();
  }
}
