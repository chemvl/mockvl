import type { Hono } from "hono";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { cached } from "@/lib/cache";
import type { AppEnv } from "@/lib/context";
import { redis } from "@/lib/redis";
import { createRedisRateLimitStore } from "@/middleware/rate-limit-redis-store";
import { createMocksRepo } from "@/modules/mocks/mocks.repo";
import { createOverridesRepo } from "@/modules/mocks/overrides.repo";
import { createRedisUsageStore, createUsageCounter } from "@/modules/usage/usage-counter";
import { createMockApp } from "./mock-app";
import { createOperationsCache, createVersionOperationsLoader } from "./operations-cache";
import { createOverrideStore } from "./override-store";
import { createRouteResolver } from "./route-resolver";

// Production graph for the mock runtime. Primary-pinned repo: a route is read
// back right after a management mutation invalidates it, and a lagging replica
// would re-cache the stale route for 60 s.
export function createDefaultMockApp(): Hono<AppEnv> {
  const mocksRepo = createMocksRepo(db.$primary);
  return createMockApp({
    resolver: createRouteResolver({ mocksRepo, cached }),
    operations: createOperationsCache({
      max: env.MOCK_OPS_CACHE_SIZE,
      load: createVersionOperationsLoader(mocksRepo),
    }),
    overrides: createOverrideStore({ repo: createOverridesRepo(db.$primary), cached }),
    usage: createUsageCounter({ store: createRedisUsageStore(redis) }),
    rateLimit: {
      windowMs: 60_000,
      limit: env.MOCK_RATE_LIMIT_PER_MINUTE,
      trustProxy: env.TRUST_PROXY,
      store: createRedisRateLimitStore({
        client: redis,
        prefix: "rl:mock:",
        failOpen: env.RATE_LIMIT_FAIL_OPEN,
      }),
    },
    appOrigin: new URL(env.APP_URL).origin,
  });
}
