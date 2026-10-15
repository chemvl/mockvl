import "../setup";

import { describe, expect, test } from "bun:test";
import type { SendOptions } from "pg-boss";
import { createAdminNotificationsService } from "@/admin/notifications/admin-notifications.service";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createFakeDevicesRepo,
  createFakeNotificationsRepo,
  createFakeUserNotificationsRepo,
  createRecordingPushSender,
  deviceRow,
  notificationRow,
} from "../helpers/push-fakes";

const ADMIN_ID = "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a";
const USER_ID = "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f";

function buildService(seed: Parameters<typeof createFakeNotificationsRepo>[0] = []) {
  const notifications = createFakeNotificationsRepo(seed);
  const userNotifications = createFakeUserNotificationsRepo();
  const devices = createFakeDevicesRepo([
    deviceRow({ userId: USER_ID, token: "tok-1" }),
    deviceRow({ userId: USER_ID, token: "tok-2", pushEnabled: false }),
  ]);
  const enqueued: { name: string; data: unknown; options?: SendOptions }[] = [];
  const canceled: string[] = [];
  const push = createRecordingPushSender();
  const service = createAdminNotificationsService({
    notificationsRepo: notifications.repo,
    userNotificationsRepo: userNotifications.repo,
    devicesRepo: devices.repo,
    enqueue: async (name, data, options) => {
      enqueued.push({ name, data, ...(options ? { options } : {}) });
      return `job-${enqueued.length}`;
    },
    cancelJob: async (_name, jobId) => {
      canceled.push(jobId);
    },
    pushSender: push.sender,
  });
  return { service, notifications, userNotifications, enqueued, canceled, push };
}

describe("admin notifications service — lifecycle guards", () => {
  test("create stores a draft attributed to the admin", async () => {
    const { service } = buildService();
    const created = await service.create(
      {
        title: "Hi",
        body: "There",
        imageUrl: null,
        deepLink: null,
        data: {},
        audience: "all",
        userIds: null,
      },
      ADMIN_ID,
    );
    expect(created).toMatchObject({ status: "draft", source: "admin", createdByAdminId: ADMIN_ID });
  });

  test.each([
    "sending",
    "sent",
    "failed",
    "canceled",
  ] as const)("update conflicts when status is %s", async (status) => {
    const row = notificationRow({ status });
    const { service } = buildService([row]);
    await expect(service.update(row.id, { title: "New" })).rejects.toBeInstanceOf(ConflictError);
  });

  test("update flips userIds to null when audience returns to all", async () => {
    const row = notificationRow({ status: "draft", audience: "users", userIds: [USER_ID] });
    const { service } = buildService([row]);
    const updated = await service.update(row.id, { audience: "all" });
    expect(updated.userIds).toBeNull();
  });

  test('update rejects audience "users" with no userIds anywhere', async () => {
    const row = notificationRow({ status: "draft" });
    const { service } = buildService([row]);
    await expect(service.update(row.id, { audience: "users" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("send claims draft → sending and enqueues exactly one job", async () => {
    const row = notificationRow({ status: "draft" });
    const { service, enqueued } = buildService([row]);
    const sent = await service.send(row.id);
    expect(sent.status).toBe("sending");
    expect(enqueued).toEqual([{ name: "push-send", data: { notificationId: row.id } }]);
  });

  test("send conflicts once the notification is already sending", async () => {
    const row = notificationRow({ status: "sending" });
    const { service, enqueued } = buildService([row]);
    await expect(service.send(row.id)).rejects.toBeInstanceOf(ConflictError);
    expect(enqueued).toHaveLength(0);
  });

  test("send of an unknown id 404s", async () => {
    const { service } = buildService();
    await expect(service.send(crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  test("schedule stores the job id and rejects past dates", async () => {
    const row = notificationRow({ status: "draft" });
    const { service, enqueued } = buildService([row]);

    await expect(service.schedule(row.id, "2020-01-01T00:00:00.000Z")).rejects.toBeInstanceOf(
      ValidationError,
    );

    const future = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await service.schedule(row.id, future);
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.bossJobId).toBe("job-1");
    expect(enqueued[0]?.options?.startAfter).toEqual(new Date(future));
  });

  test("re-schedule withdraws the previous boss job", async () => {
    const row = notificationRow({ status: "scheduled", bossJobId: "job-old" });
    const { service, canceled } = buildService([row]);
    await service.schedule(row.id, new Date(Date.now() + 60_000).toISOString());
    expect(canceled).toEqual(["job-old"]);
  });

  test("cancel only works from scheduled and withdraws the job", async () => {
    const scheduledRow = notificationRow({ status: "scheduled", bossJobId: "job-9" });
    const { service, canceled } = buildService([scheduledRow]);
    const result = await service.cancel(scheduledRow.id);
    expect(result.status).toBe("canceled");
    expect(canceled).toEqual(["job-9"]);

    const draftRow = notificationRow({ status: "draft" });
    const { service: service2 } = buildService([draftRow]);
    await expect(service2.cancel(draftRow.id)).rejects.toBeInstanceOf(ConflictError);
  });

  test.each([
    "scheduled",
    "sending",
    "sent",
  ] as const)("remove conflicts when status is %s", async (status) => {
    const row = notificationRow({ status });
    const { service } = buildService([row]);
    await expect(service.remove(row.id)).rejects.toBeInstanceOf(ConflictError);
  });

  test("remove deletes a draft", async () => {
    const row = notificationRow({ status: "draft" });
    const { service, notifications } = buildService([row]);
    await service.remove(row.id);
    expect(notifications.rows.has(row.id)).toBe(false);
  });
});

describe("admin notifications service — test-send and stats", () => {
  test("testSend hits only the user's enabled devices and writes no inbox rows", async () => {
    const row = notificationRow({ status: "draft", deepLink: "/home" });
    const { service, userNotifications, push } = buildService([row]);
    const result = await service.testSend(row.id, USER_ID);
    // tok-2 is opted out — only tok-1 receives.
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(push.sent.map((m) => m.token)).toEqual(["tok-1"]);
    expect(push.sent[0]?.data).toMatchObject({ notificationId: row.id, deepLink: "/home" });
    expect(userNotifications.inbox.size).toBe(0);
  });

  test("stats combines device targeting with inbox counts", async () => {
    const row = notificationRow({
      status: "sent",
      audience: "users",
      userIds: [USER_ID],
      sentCount: 1,
      failedCount: 0,
    });
    const { service, userNotifications } = buildService([row]);
    await userNotifications.repo.insertMany(row.id, [USER_ID]);
    const stats = await service.stats(row.id);
    expect(stats).toEqual({
      targetedDevices: 1,
      sentCount: 1,
      failedCount: 0,
      inboxCount: 1,
      readCount: 0,
    });
  });
});
