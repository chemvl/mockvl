// In-memory fakes shared by the push-notification unit tests. They mirror the
// real repos' guard semantics (status-gated updates, inbox unique index) so
// service and worker tests exercise the same concurrency rules production hits.

import type { PushMessage, PushSender, PushSendResult } from "@/clients/fcm";
import type { devices, notifications } from "@/db/schema";
import type { DevicesRepo } from "@/modules/devices/devices.repo";
import type { NotificationsRepo } from "@/modules/notifications/notifications.repo";
import type { UserNotificationsRepo } from "@/modules/notifications/user-notifications.repo";
import type { UserRepo } from "@/modules/users/users.repo";

type NotificationRow = typeof notifications.$inferSelect;
type DeviceRow = typeof devices.$inferSelect;

export function notificationRow(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: crypto.randomUUID(),
    source: "admin",
    title: "Hello",
    body: "World",
    imageUrl: null,
    deepLink: null,
    data: {},
    audience: "all",
    userIds: null,
    status: "draft",
    scheduledAt: null,
    sentAt: null,
    sentCount: 0,
    failedCount: 0,
    bossJobId: null,
    createdByAdminId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function deviceRow(overrides: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    token: crypto.randomUUID(),
    platform: "android",
    pushEnabled: true,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createFakeNotificationsRepo(seed: NotificationRow[] = []) {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const repo: NotificationsRepo = {
    async create(input) {
      const row = notificationRow({
        ...input,
        id: crypto.randomUUID(),
      } as Partial<NotificationRow>);
      rows.set(row.id, row);
      return row;
    },
    async findById(id) {
      return rows.get(id);
    },
    async list() {
      return { rows: [...rows.values()], total: rows.size };
    },
    async updateWhereStatusIn(id, fromStatuses, patch) {
      const row = rows.get(id);
      if (!row || !fromStatuses.includes(row.status)) return undefined;
      const updated = { ...row, ...patch, updatedAt: new Date() } as NotificationRow;
      rows.set(id, updated);
      return updated;
    },
    async addCounts(id, sent, failed) {
      const row = rows.get(id);
      if (!row) return;
      rows.set(id, {
        ...row,
        sentCount: row.sentCount + sent,
        failedCount: row.failedCount + failed,
      });
    },
    async deleteWhereStatusIn(id, fromStatuses) {
      const row = rows.get(id);
      if (!row || !fromStatuses.includes(row.status)) return undefined;
      rows.delete(id);
      return row;
    },
  };
  return { repo, rows };
}

export function createFakeUserNotificationsRepo() {
  // Emulates the (notificationId, userId) unique index.
  const inbox = new Map<
    string,
    { id: string; notificationId: string; userId: string; readAt: Date | null; createdAt: Date }
  >();
  const key = (notificationId: string, userId: string) => `${notificationId}:${userId}`;

  const repo: UserNotificationsRepo = {
    async insertMany(notificationId, userIds) {
      for (const userId of userIds) {
        const k = key(notificationId, userId);
        if (!inbox.has(k)) {
          inbox.set(k, {
            id: crypto.randomUUID(),
            notificationId,
            userId,
            readAt: null,
            createdAt: new Date(),
          });
        }
      }
    },
    async countByNotification(notificationId) {
      const entries = [...inbox.values()].filter((e) => e.notificationId === notificationId);
      return {
        inboxCount: entries.length,
        readCount: entries.filter((e) => e.readAt).length,
      };
    },
  };
  return { repo, inbox };
}

export function createFakeDevicesRepo(seed: DeviceRow[] = []) {
  let rows = [...seed].sort((a, b) => a.id.localeCompare(b.id));
  const repo: DevicesRepo = {
    async listTokensPage({ userIds, afterId, limit }) {
      return rows
        .filter(
          (row) =>
            row.pushEnabled &&
            (!userIds || userIds.includes(row.userId)) &&
            (!afterId || row.id > afterId),
        )
        .slice(0, limit)
        .map((row) => ({ id: row.id, token: row.token, userId: row.userId }));
    },
    async distinctUserIds(userIds) {
      const all = rows
        .filter((row) => !userIds || userIds.includes(row.userId))
        .map((row) => row.userId);
      return [...new Set(all)];
    },
    async countPushTargets(userIds) {
      return rows.filter((row) => row.pushEnabled && (!userIds || userIds.includes(row.userId)))
        .length;
    },
    async deleteByTokens(tokens) {
      rows = rows.filter((row) => !tokens.includes(row.token));
    },
    async listEnabledByUser(userId) {
      return rows.filter((row) => row.userId === userId && row.pushEnabled);
    },
  };
  return {
    repo,
    get rows() {
      return rows;
    },
  };
}

// null = treat every id as an existing user (the common case in worker tests).
export function createFakeUsersRepo(existingIds: string[] | null = null) {
  const repo: Pick<UserRepo, "listExistingIds"> = {
    async listExistingIds(ids) {
      return existingIds === null ? [...ids] : ids.filter((id) => existingIds.includes(id));
    },
  };
  return { repo };
}

export function createRecordingPushSender(
  outcome: (message: PushMessage) => PushSendResult = () => ({ ok: true }),
) {
  const sent: PushMessage[] = [];
  const sender: PushSender = {
    async send(message) {
      sent.push(message);
      return outcome(message);
    },
  };
  return { sender, sent };
}
