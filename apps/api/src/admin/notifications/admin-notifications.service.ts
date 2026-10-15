import type { NotificationCreate, NotificationUpdate } from "@starter/schemas";
import type { PushSender } from "@/clients/fcm";
import type { CancelJob, Enqueue } from "@/jobs/types";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ListQuery } from "@/lib/pagination";
import type { DevicesRepo } from "@/modules/devices/devices.repo";
import type { NotificationsRepo } from "@/modules/notifications/notifications.repo";
import type { UserNotificationsRepo } from "@/modules/notifications/user-notifications.repo";

export interface AdminNotificationsServiceDeps {
  notificationsRepo: NotificationsRepo;
  userNotificationsRepo: UserNotificationsRepo;
  devicesRepo: DevicesRepo;
  enqueue: Enqueue;
  cancelJob: CancelJob;
  pushSender: PushSender;
}

// Lifecycle: draft → (send|schedule) → sending → sent|failed, with
// scheduled → canceled as the withdrawal path. Every transition is a guarded
// UPDATE (status IN ...) so concurrent admin actions and the worker can never
// double-run a send — the DB row is the lock.
export function createAdminNotificationsService(deps: AdminNotificationsServiceDeps) {
  const { notificationsRepo, userNotificationsRepo, devicesRepo, enqueue, cancelJob, pushSender } =
    deps;

  async function getOrThrow(id: string) {
    const notification = await notificationsRepo.findById(id);
    if (!notification) throw new NotFoundError("Notification not found");
    return notification;
  }

  // Withdraw a previously scheduled pg-boss job. Best-effort: the worker's
  // status guard is the real safety net, so a cancel miss is only noise.
  async function cancelScheduledJob(bossJobId: string | null): Promise<void> {
    if (!bossJobId) return;
    try {
      await cancelJob("push-send", bossJobId);
    } catch (err) {
      logger.warn({ err, bossJobId }, "admin-notifications: boss job cancel failed (best-effort)");
    }
  }

  return {
    async list(query: ListQuery) {
      return notificationsRepo.list(query);
    },

    async getById(id: string) {
      return getOrThrow(id);
    },

    async create(input: NotificationCreate, adminId: string) {
      return notificationsRepo.create({
        source: "admin",
        title: input.title,
        body: input.body,
        imageUrl: input.imageUrl,
        deepLink: input.deepLink,
        data: input.data,
        audience: input.audience,
        userIds: input.audience === "users" ? input.userIds : null,
        status: "draft",
        createdByAdminId: adminId,
      });
    },

    async update(id: string, input: NotificationUpdate) {
      const current = await getOrThrow(id);
      if (input.audience === "users" && !(input.userIds ?? current.userIds)?.length) {
        throw new ValidationError('userIds is required when audience is "users"');
      }
      const patch = {
        ...input,
        // Keep the pair consistent when audience flips to "all".
        ...(input.audience === "all" ? { userIds: null } : {}),
      };
      const updated = await notificationsRepo.updateWhereStatusIn(
        id,
        ["draft", "scheduled"],
        patch,
      );
      if (!updated) {
        throw new ConflictError(`Cannot edit a notification in status "${current.status}"`);
      }
      return updated;
    },

    async remove(id: string) {
      const current = await getOrThrow(id);
      const deleted = await notificationsRepo.deleteWhereStatusIn(id, [
        "draft",
        "canceled",
        "failed",
      ]);
      if (!deleted) {
        throw new ConflictError(`Cannot delete a notification in status "${current.status}"`);
      }
    },

    async send(id: string) {
      const current = await getOrThrow(id);
      const claimed = await notificationsRepo.updateWhereStatusIn(id, ["draft", "scheduled"], {
        status: "sending",
        scheduledAt: null,
        bossJobId: null,
      });
      if (!claimed) {
        throw new ConflictError(`Cannot send a notification in status "${current.status}"`);
      }
      await cancelScheduledJob(current.bossJobId);
      await enqueue("push-send", { notificationId: id });
      return claimed;
    },

    async schedule(id: string, scheduledAtIso: string) {
      const scheduledAt = new Date(scheduledAtIso);
      if (scheduledAt.getTime() <= Date.now()) {
        throw new ValidationError("scheduledAt must be in the future");
      }
      const current = await getOrThrow(id);
      const claimed = await notificationsRepo.updateWhereStatusIn(id, ["draft", "scheduled"], {
        status: "scheduled",
        scheduledAt,
      });
      if (!claimed) {
        throw new ConflictError(`Cannot schedule a notification in status "${current.status}"`);
      }
      // Re-scheduling withdraws the previous job before queueing the new one.
      await cancelScheduledJob(current.bossJobId);
      const bossJobId = await enqueue(
        "push-send",
        { notificationId: id },
        { startAfter: scheduledAt },
      );
      const withJob = await notificationsRepo.updateWhereStatusIn(id, ["scheduled"], {
        bossJobId,
      });
      return withJob ?? claimed;
    },

    async cancel(id: string) {
      const current = await getOrThrow(id);
      const canceled = await notificationsRepo.updateWhereStatusIn(id, ["scheduled"], {
        status: "canceled",
      });
      if (!canceled) {
        throw new ConflictError(`Cannot cancel a notification in status "${current.status}"`);
      }
      await cancelScheduledJob(current.bossJobId);
      return canceled;
    },

    // Direct delivery preview to one user's devices: no inbox rows, no count
    // changes, works in any status.
    async testSend(id: string, userId: string) {
      const notification = await getOrThrow(id);
      const targets = await devicesRepo.listEnabledByUser(userId);
      let sent = 0;
      let failed = 0;
      for (const device of targets) {
        const result = await pushSender.send({
          token: device.token,
          title: notification.title,
          body: notification.body,
          imageUrl: notification.imageUrl,
          data: {
            ...notification.data,
            notificationId: notification.id,
            ...(notification.deepLink ? { deepLink: notification.deepLink } : {}),
          },
        });
        if (result.ok) sent += 1;
        else failed += 1;
      }
      return { sent, failed };
    },

    async stats(id: string) {
      const notification = await getOrThrow(id);
      const targetUserIds = notification.audience === "users" ? (notification.userIds ?? []) : null;
      const [targetedDevices, inboxCounts] = await Promise.all([
        devicesRepo.countPushTargets(targetUserIds),
        userNotificationsRepo.countByNotification(id),
      ]);
      return {
        targetedDevices,
        sentCount: notification.sentCount,
        failedCount: notification.failedCount,
        inboxCount: inboxCounts.inboxCount,
        readCount: inboxCounts.readCount,
      };
    },
  };
}

export type AdminNotificationsService = ReturnType<typeof createAdminNotificationsService>;
