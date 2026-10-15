import { META_RESOURCES_CACHE_PREFIX } from "./admin/meta.routes";
import { createApp } from "./app";
import { createConfiguredEmailSender, createLogOnlyEmailSender } from "./clients/email";
import { env } from "./config/env";
import { closeDatabase, db, pingDatabase } from "./db/client";
import { startBoss, stopBoss } from "./jobs/boss";
import {
  registerFlushMockUsageWorker,
  scheduleFlushMockUsage,
} from "./jobs/workers/flush-mock-usage";
import { registerInviteEmailWorker } from "./jobs/workers/invite-email";
import {
  registerPurgeDeletedWorkspacesWorker,
  schedulePurgeDeletedWorkspaces,
} from "./jobs/workers/purge-deleted-workspaces";
import { registerPushSendWorker } from "./jobs/workers/push-send";
import {
  createWelcomeEmailDelivery,
  registerWelcomeEmailWorker,
} from "./jobs/workers/welcome-email";
import { invalidate } from "./lib/cache";
import { logger } from "./lib/logger";
import { closeRedis, pingRedis, redis } from "./lib/redis";
import { createRedisRateLimitStore } from "./middleware/rate-limit-redis-store";
import { createDefaultMockApp } from "./modules/mock-runtime/mock-app.defaults";
import { createUsageRepo } from "./modules/usage/usage.repo";
import { createInvitesRepo } from "./modules/workspaces/invites.repo";
import { createWorkspacesRepo } from "./modules/workspaces/workspaces.repo";
import { createRootApp } from "./root";

// Jobs infrastructure first: the API enqueues the welcome email on first
// Google sign-in, and workers run in-process by default (run `bun run worker`
// for a separate worker process). With no email provider configured
// (EMAIL_PROVIDER + credentials, config/env.ts) workers keep their log-only
// defaults.
const boss = await startBoss();
const emailSender = createConfiguredEmailSender();
await registerWelcomeEmailWorker(
  boss,
  emailSender ? { sendWelcomeEmail: createWelcomeEmailDelivery(emailSender) } : {},
);
await registerPushSendWorker(boss);
// Invites keep their own job so a resend can supersede an unsent email.
await registerInviteEmailWorker(boss, {
  loadInvite: (id) => createInvitesRepo(db.$primary).findEmailContext(id),
  sender: emailSender ?? createLogOnlyEmailSender(),
  appUrl: env.APP_URL,
});
// Mockyard usage: Redis hourly counters → mock_usage_hourly every minute.
await registerFlushMockUsageWorker(boss, {
  client: redis,
  usageRepo: createUsageRepo(db.$primary),
});
await scheduleFlushMockUsage(boss);
// Soft-deleted workspaces are hard-deleted 30 days later, daily.
await registerPurgeDeletedWorkspacesWorker(boss, {
  workspacesRepo: createWorkspacesRepo(db.$primary),
});
await schedulePurgeDeletedWorkspaces(boss);

// The meta payload is static at runtime — the registry only changes with a
// deploy — so its cache is swept once per process start (PLAN 8.5c/9b).
// invalidate() swallows Redis outages: stale-until-TTL beats failing boot.
await invalidate(`${META_RESOURCES_CACHE_PREFIX}*`);

const api = createApp({
  readinessChecks: [
    { name: "db", check: () => pingDatabase() },
    { name: "redis", check: () => pingRedis() },
  ],
  // Redis-backed limiters so every instance shares one budget (Phase 8.5b).
  // createApp's own defaults stay in-memory — tests and one-off scripts don't
  // need Redis; production wiring opts in here, one store per tier so the
  // global and auth counters stay separate. Limits/windows come from env
  // (RATE_LIMIT_*) so deployments tune them without a code change.
  rateLimit: {
    global: {
      windowMs: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
      limit: env.RATE_LIMIT_GLOBAL_LIMIT,
      trustProxy: env.TRUST_PROXY,
      store: createRedisRateLimitStore({
        client: redis,
        prefix: "rl:global:",
        failOpen: env.RATE_LIMIT_FAIL_OPEN,
      }),
    },
    auth: {
      windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
      limit: env.RATE_LIMIT_AUTH_LIMIT,
      trustProxy: env.TRUST_PROXY,
      store: createRedisRateLimitStore({
        client: redis,
        prefix: "rl:auth:",
        failOpen: env.RATE_LIMIT_FAIL_OPEN,
      }),
    },
  },
});

const server = Bun.serve({
  port: env.PORT,
  fetch: createRootApp({ api, mock: createDefaultMockApp() }).fetch,
});

logger.info({ port: env.PORT, env: env.NODE_ENV }, "api listening");

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "shutting down");
  // Close order: HTTP → pg-boss → Redis → PG pool. Redis goes before the
  // pool because draining jobs may still read the DB, but nothing after the
  // boss stops needs the cache.
  await server.stop();
  // Let active jobs finish before the DB pool goes away.
  await stopBoss();
  await closeRedis();
  await closeDatabase();
  logger.info("shutdown complete");
  process.exit(0);
}

function onSignal(signal: string): void {
  shutdown(signal).catch((err: unknown) => {
    logger.error({ err, signal }, "shutdown failed");
    process.exit(1);
  });
}

process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));
