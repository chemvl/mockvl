// Worker-only entry: starts pg-boss workers without the HTTP server.
// Same image, different command (`bun run worker`) for production separation.
import { createConfiguredEmailSender, createLogOnlyEmailSender } from "./clients/email";
import { env } from "./config/env";
import { db } from "./db/client";
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
import { logger } from "./lib/logger";
import { closeRedis, redis } from "./lib/redis";
import { createUsageRepo } from "./modules/usage/usage.repo";
import { createInvitesRepo } from "./modules/workspaces/invites.repo";
import { createWorkspacesRepo } from "./modules/workspaces/workspaces.repo";

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
// Mockvl usage: Redis hourly counters → mock_usage_hourly every minute.
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

logger.info("worker process listening for jobs");

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "worker shutting down");
  // Graceful: active jobs get to finish (stopBoss carries the timeout).
  await stopBoss();
  // The flush worker holds a Redis connection.
  await closeRedis();
  logger.info("worker shutdown complete");
  process.exit(0);
}

function onSignal(signal: string): void {
  shutdown(signal).catch((err: unknown) => {
    logger.error({ err, signal }, "worker shutdown failed");
    process.exit(1);
  });
}

process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));
