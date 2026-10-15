import type { Job, PgBoss, Queue, WorkOptions } from "pg-boss";
import type { PushSender } from "@/clients/fcm";
import { createPushSender } from "@/clients/fcm";
import { db } from "@/db/client";
import type { notifications } from "@/db/schema";
import { PushSendJobSchema } from "@/jobs/types";
import { logger } from "@/lib/logger";
import { createDevicesRepo, type DevicesRepo } from "@/modules/devices/devices.repo";
import {
  createNotificationsRepo,
  type NotificationsRepo,
} from "@/modules/notifications/notifications.repo";
import {
  createUserNotificationsRepo,
  type UserNotificationsRepo,
} from "@/modules/notifications/user-notifications.repo";
import { createUserRepo, type UserRepo } from "@/modules/users/users.repo";

type NotificationRow = typeof notifications.$inferSelect;

export const PUSH_SEND_QUEUE = "push-send";

// A broadcast to ~100k devices takes minutes: raise the expiration so an
// in-flight fan-out is not reaped mid-run (pg-boss default is 15 min).
export const PUSH_SEND_QUEUE_OPTIONS: Omit<Queue, "name"> = {
  retryLimit: 3,
  retryBackoff: true,
  expireInSeconds: 3600,
};

// FCM HTTP v1 is one POST per token; page through devices and send each page
// in bounded-concurrency groups (no dependency needed at this fan-out shape).
const DEVICE_PAGE_SIZE = 500;
const SEND_CONCURRENCY = 40;

export interface PushSendWorkerDeps {
  notificationsRepo?: NotificationsRepo;
  userNotificationsRepo?: UserNotificationsRepo;
  devicesRepo?: DevicesRepo;
  usersRepo?: Pick<UserRepo, "listExistingIds">;
  // Test seam / provider hook — defaults to env-driven FCM or log-only.
  pushSender?: PushSender;
}

function buildDataPayload(notification: NotificationRow): Record<string, string> {
  return {
    ...notification.data,
    // Reserved keys win over campaign data: client apps rely on them for
    // navigation and to correlate the push with its notification.
    notificationId: notification.id,
    ...(notification.deepLink ? { deepLink: notification.deepLink } : {}),
  };
}

export function createPushSendHandler(deps: PushSendWorkerDeps = {}) {
  const notificationsRepo = deps.notificationsRepo ?? createNotificationsRepo(db);
  const userNotificationsRepo = deps.userNotificationsRepo ?? createUserNotificationsRepo(db);
  const devicesRepo = deps.devicesRepo ?? createDevicesRepo(db);
  const usersRepo = deps.usersRepo ?? createUserRepo(db);
  const pushSender = deps.pushSender ?? createPushSender();

  async function sendPage(
    notification: NotificationRow,
    page: { token: string }[],
  ): Promise<{ sent: number; failed: number; staleTokens: string[] }> {
    let sent = 0;
    let failed = 0;
    const staleTokens: string[] = [];
    for (let i = 0; i < page.length; i += SEND_CONCURRENCY) {
      const group = page.slice(i, i + SEND_CONCURRENCY);
      const results = await Promise.allSettled(
        group.map((device) =>
          pushSender.send({
            token: device.token,
            title: notification.title,
            body: notification.body,
            imageUrl: notification.imageUrl,
            data: buildDataPayload(notification),
          }),
        ),
      );
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") {
          failed += 1;
          return;
        }
        const outcome = result.value;
        if (outcome.ok) {
          sent += 1;
          return;
        }
        failed += 1;
        if (outcome.reason === "unregistered" || outcome.reason === "invalid-token") {
          const device = group[index];
          if (device) staleTokens.push(device.token);
        }
      });
    }
    return { sent, failed, staleTokens };
  }

  async function processNotification(notificationId: string): Promise<void> {
    const notification = await notificationsRepo.findById(notificationId);
    if (!notification) {
      logger.warn({ notificationId }, "push-send: notification row missing, dropping job");
      return;
    }
    // Terminal or never-released states: ack silently. This is also how a
    // canceled scheduled send dies even when boss.cancel missed the job.
    if (notification.status !== "sending" && notification.status !== "scheduled") {
      logger.info(
        { notificationId, status: notification.status },
        "push-send: nothing to do for this status",
      );
      return;
    }
    let current = notification;
    if (notification.status === "scheduled") {
      // Guarded claim — loses the race iff an admin canceled concurrently.
      const claimed = await notificationsRepo.updateWhereStatusIn(notificationId, ["scheduled"], {
        status: "sending",
      });
      if (!claimed) return;
      current = claimed;
    }

    const targetUserIds = current.audience === "users" ? (current.userIds ?? []) : null;

    // Inbox fan-out first, idempotently. Devices gate FCM only: an explicitly
    // targeted user gets an inbox row even with no registered device, while a
    // broadcast resolves to users holding a device at send time. Targeted ids
    // are narrowed to existing users so a stale id cannot FK-fail the job.
    const recipients = targetUserIds
      ? await usersRepo.listExistingIds(targetUserIds)
      : await devicesRepo.distinctUserIds(null);
    await userNotificationsRepo.insertMany(current.id, recipients);

    // FCM fan-out: keyset pagination over enabled devices. Counts are
    // incremented per page so the admin console shows live progress. A retry
    // after a mid-run crash re-sends earlier pages (at-least-once delivery);
    // the inbox stays exactly-once via its unique index.
    let afterId: string | null = null;
    let targeted = 0;
    for (;;) {
      const page = await devicesRepo.listTokensPage({
        userIds: targetUserIds,
        afterId,
        limit: DEVICE_PAGE_SIZE,
      });
      if (page.length === 0) break;
      afterId = page[page.length - 1]?.id ?? null;
      targeted += page.length;

      const { sent, failed, staleTokens } = await sendPage(current, page);
      await devicesRepo.deleteByTokens(staleTokens);
      await notificationsRepo.addCounts(current.id, sent, failed);

      if (page.length < DEVICE_PAGE_SIZE) break;
    }

    const final = await notificationsRepo.findById(current.id);
    const succeeded = (final?.sentCount ?? 0) > 0 || targeted === 0;
    await notificationsRepo.updateWhereStatusIn(current.id, ["sending"], {
      status: succeeded ? "sent" : "failed",
      sentAt: new Date(),
    });
    logger.info(
      {
        notificationId: current.id,
        targeted,
        sentCount: final?.sentCount ?? 0,
        failedCount: final?.failedCount ?? 0,
      },
      "push-send: fan-out complete",
    );
  }

  // Handlers receive a batch (pg-boss v12); with the default batchSize of 1
  // the array holds one job. A throw fails the whole batch so pg-boss retries.
  return async (jobs: Pick<Job<unknown>, "id" | "name" | "data">[]): Promise<void> => {
    for (const job of jobs) {
      const payload = PushSendJobSchema.parse(job.data);
      await processNotification(payload.notificationId);
    }
  };
}

export interface RegisterPushSendWorkerOptions extends PushSendWorkerDeps {
  // Overridable in tests (e.g. tiny retry delays); production uses the defaults.
  queueOptions?: Omit<Queue, "name">;
  workOptions?: WorkOptions;
}

export async function registerPushSendWorker(
  boss: PgBoss,
  options: RegisterPushSendWorkerOptions = {},
): Promise<void> {
  const { queueOptions = PUSH_SEND_QUEUE_OPTIONS, workOptions = {}, ...deps } = options;
  // Create-if-absent: an existing queue keeps its stored options.
  await boss.createQueue(PUSH_SEND_QUEUE, queueOptions);
  await boss.work(PUSH_SEND_QUEUE, workOptions, createPushSendHandler(deps));
}
