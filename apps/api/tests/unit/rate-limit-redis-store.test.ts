import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { createApp } from "@/app";
import { RateLimitError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { closeRedis, createRedis } from "@/lib/redis";
import { createRedisRateLimitStore } from "@/middleware/rate-limit-redis-store";

// Fail-open/fail-closed behavior needs a *dead* Redis, so no external service
// is involved — port 1 refuses connections immediately.
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

describe("createRedisRateLimitStore with Redis down", () => {
  test("fail-open: increment allows the request and logs RATE_LIMIT_STORE_DOWN", async () => {
    const { logger, lines } = captureLogger();
    const store = createRedisRateLimitStore({
      client: deadRedis,
      prefix: "rl:test:",
      failOpen: true,
      log: logger,
    });
    store.init?.({ windowMs: 60_000 } as never);

    const info = await store.increment("client-a");

    expect(info.totalHits).toBe(0);
    const errorLine = lines.map((line) => JSON.parse(line)).find((entry) => entry.code);
    expect(errorLine?.code).toBe("RATE_LIMIT_STORE_DOWN");
    expect(errorLine?.level).toBe(50); // pino error
  });

  test("logs RATE_LIMIT_STORE_DOWN once per outage, not once per request", async () => {
    const { logger, lines } = captureLogger();
    const store = createRedisRateLimitStore({
      client: deadRedis,
      prefix: "rl:test:",
      failOpen: true,
      log: logger,
    });
    store.init?.({ windowMs: 60_000 } as never);

    await store.increment("client-a");
    await store.increment("client-a");
    await store.increment("client-b");

    const downLines = lines
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.code === "RATE_LIMIT_STORE_DOWN");
    expect(downLines).toHaveLength(1);
  });

  test("fail-closed: increment throws RateLimitError", async () => {
    const { logger } = captureLogger();
    const store = createRedisRateLimitStore({
      client: deadRedis,
      prefix: "rl:test:",
      failOpen: false,
      log: logger,
    });
    store.init?.({ windowMs: 60_000 } as never);

    await expect(store.increment("client-a")).rejects.toBeInstanceOf(RateLimitError);
  });

  test("decrement and resetKey swallow store errors", async () => {
    const { logger } = captureLogger();
    const store = createRedisRateLimitStore({
      client: deadRedis,
      prefix: "rl:test:",
      failOpen: true,
      log: logger,
    });

    await expect(Promise.resolve(store.decrement("client-a"))).resolves.toBeUndefined();
    await expect(Promise.resolve(store.resetKey("client-a"))).resolves.toBeUndefined();
  });
});

describe("app behavior with the store down", () => {
  test("fail-open=true serves traffic", async () => {
    const { logger } = captureLogger();
    const app = createApp({
      rateLimit: {
        global: {
          windowMs: 60_000,
          limit: 2,
          store: createRedisRateLimitStore({
            client: deadRedis,
            prefix: "rl:test-open:",
            failOpen: true,
            log: logger,
          }),
        },
      },
    });

    // Well past the limit — every request is allowed while the store is down.
    for (let i = 0; i < 4; i++) {
      const res = await app.request("/api/users/me");
      expect(res.status).toBe(401); // reached auth, not rate limiting
    }
  });

  test("fail-open=false returns the 429 envelope", async () => {
    const { logger } = captureLogger();
    const app = createApp({
      rateLimit: {
        global: {
          windowMs: 60_000,
          limit: 2,
          store: createRedisRateLimitStore({
            client: deadRedis,
            prefix: "rl:test-closed:",
            failOpen: false,
            log: logger,
          }),
        },
      },
    });

    const res = await app.request("/api/users/me");
    const body = (await res.json()) as { error: { code: string; requestId?: string } };

    expect(res.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.requestId).toBeDefined();
  });
});
