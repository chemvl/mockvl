import "../setup";

import { describe, expect, test } from "bun:test";
import { createPushSendHandler } from "@/jobs/workers/push-send";
import {
  createFakeDevicesRepo,
  createFakeNotificationsRepo,
  createFakeUserNotificationsRepo,
  createFakeUsersRepo,
  createRecordingPushSender,
  deviceRow,
  notificationRow,
} from "../helpers/push-fakes";

const USER_A = "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a";
const USER_B = "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f";

function build(options: {
  notification: ReturnType<typeof notificationRow>;
  devices?: ReturnType<typeof deviceRow>[];
  // null (default) = every targeted id is an existing user.
  knownUsers?: string[];
  outcome?: Parameters<typeof createRecordingPushSender>[0];
}) {
  const notifications = createFakeNotificationsRepo([options.notification]);
  const userNotifications = createFakeUserNotificationsRepo();
  const devices = createFakeDevicesRepo(options.devices ?? []);
  const users = createFakeUsersRepo(options.knownUsers ?? null);
  const push = createRecordingPushSender(options.outcome);
  const handler = createPushSendHandler({
    notificationsRepo: notifications.repo,
    userNotificationsRepo: userNotifications.repo,
    devicesRepo: devices.repo,
    usersRepo: users.repo,
    pushSender: push.sender,
  });
  const run = () =>
    handler([
      { id: "job-1", name: "push-send", data: { notificationId: options.notification.id } },
    ]);
  return { run, notifications, userNotifications, devices, push };
}

describe("push-send worker", () => {
  test("broadcast: inbox rows for every user with a device, FCM only to enabled ones", async () => {
    const notification = notificationRow({ status: "sending", deepLink: "/news" });
    const { run, notifications, userNotifications, push } = build({
      notification,
      devices: [
        deviceRow({ userId: USER_A, token: "tok-a1" }),
        deviceRow({ userId: USER_A, token: "tok-a2", pushEnabled: false }),
        deviceRow({ userId: USER_B, token: "tok-b1" }),
      ],
    });
    await run();

    // Inbox: both users (opt-out gates FCM only, not the inbox).
    expect(userNotifications.inbox.size).toBe(2);
    // FCM: only the two enabled tokens.
    expect(push.sent.map((m) => m.token).sort()).toEqual(["tok-a1", "tok-b1"]);
    expect(push.sent[0]?.data).toMatchObject({
      notificationId: notification.id,
      deepLink: "/news",
    });

    const final = notifications.rows.get(notification.id);
    expect(final).toMatchObject({ status: "sent", sentCount: 2, failedCount: 0 });
    expect(final?.sentAt).not.toBeNull();
  });

  test('audience "users": only the listed users are targeted', async () => {
    const notification = notificationRow({
      status: "sending",
      audience: "users",
      userIds: [USER_A],
    });
    const { run, userNotifications, push } = build({
      notification,
      devices: [
        deviceRow({ userId: USER_A, token: "tok-a1" }),
        deviceRow({ userId: USER_B, token: "tok-b1" }),
      ],
    });
    await run();
    expect([...userNotifications.inbox.values()].map((e) => e.userId)).toEqual([USER_A]);
    expect(push.sent.map((m) => m.token)).toEqual(["tok-a1"]);
  });

  test('audience "users": a targeted user with no device still gets an inbox row', async () => {
    const notification = notificationRow({
      status: "sending",
      audience: "users",
      userIds: [USER_A, USER_B],
    });
    const { run, notifications, userNotifications, push } = build({
      notification,
      // USER_A has no device: no push is possible, but the inbox row must
      // still be written — the inbox is the source of truth.
      devices: [deviceRow({ userId: USER_B, token: "tok-b1" })],
    });
    await run();

    const inboxUserIds = [...userNotifications.inbox.values()].map((e) => e.userId).sort();
    expect(inboxUserIds).toEqual([USER_A, USER_B].sort());
    expect(push.sent.map((m) => m.token)).toEqual(["tok-b1"]);
    expect(notifications.rows.get(notification.id)?.status).toBe("sent");
  });

  test('audience "users": ids that are not real users are skipped, not fatal', async () => {
    const ghost = "0f0e0d0c-0b0a-4998-8776-655443322110";
    const notification = notificationRow({
      status: "sending",
      audience: "users",
      userIds: [USER_A, ghost],
    });
    const { run, userNotifications } = build({
      notification,
      knownUsers: [USER_A],
    });
    await run();
    expect([...userNotifications.inbox.values()].map((e) => e.userId)).toEqual([USER_A]);
  });

  test("scheduled notifications are claimed to sending before fan-out", async () => {
    const notification = notificationRow({ status: "scheduled" });
    const { run, notifications } = build({
      notification,
      devices: [deviceRow({ userId: USER_A })],
    });
    await run();
    expect(notifications.rows.get(notification.id)?.status).toBe("sent");
  });

  test.each([
    "canceled",
    "sent",
    "failed",
    "draft",
  ] as const)("a %s notification is acked without sending", async (status) => {
    const notification = notificationRow({ status });
    const { run, push, userNotifications } = build({
      notification,
      devices: [deviceRow({ userId: USER_A })],
    });
    await run();
    expect(push.sent).toHaveLength(0);
    expect(userNotifications.inbox.size).toBe(0);
  });

  test("unregistered/invalid tokens are deleted and counted as failed", async () => {
    const notification = notificationRow({ status: "sending" });
    const { run, notifications, devices, push } = build({
      notification,
      devices: [
        deviceRow({ userId: USER_A, token: "tok-live" }),
        deviceRow({ userId: USER_A, token: "tok-dead" }),
        deviceRow({ userId: USER_B, token: "tok-bad" }),
      ],
      outcome: (message) => {
        if (message.token === "tok-dead") return { ok: false, reason: "unregistered" };
        if (message.token === "tok-bad") return { ok: false, reason: "invalid-token" };
        return { ok: true };
      },
    });
    await run();

    expect(push.sent).toHaveLength(3);
    expect(devices.rows.map((d) => d.token)).toEqual(["tok-live"]);
    expect(notifications.rows.get(notification.id)).toMatchObject({
      status: "sent",
      sentCount: 1,
      failedCount: 2,
    });
  });

  test("every delivery failing finalizes as failed", async () => {
    const notification = notificationRow({ status: "sending" });
    const { run, notifications } = build({
      notification,
      devices: [deviceRow({ userId: USER_A })],
      outcome: () => ({ ok: false, reason: "server" }),
    });
    await run();
    expect(notifications.rows.get(notification.id)).toMatchObject({
      status: "failed",
      sentCount: 0,
      failedCount: 1,
    });
  });

  test("zero targeted devices still finalizes as sent", async () => {
    const notification = notificationRow({ status: "sending" });
    const { run, notifications } = build({ notification, devices: [] });
    await run();
    expect(notifications.rows.get(notification.id)?.status).toBe("sent");
  });

  test("a retry never duplicates inbox rows (unique index semantics)", async () => {
    const notification = notificationRow({ status: "sending" });
    const { run, notifications, userNotifications } = build({
      notification,
      devices: [deviceRow({ userId: USER_A }), deviceRow({ userId: USER_B })],
    });
    await run();
    // Simulate a retry after a crash-before-finalize: force status back.
    await notifications.repo.updateWhereStatusIn(notification.id, ["sent"], {
      status: "sending",
    });
    await run();
    expect(userNotifications.inbox.size).toBe(2);
  });

  test("an unknown notification id is dropped silently", async () => {
    const notification = notificationRow({ status: "sending" });
    const { push } = build({ notification });
    const handler = createPushSendHandler({
      notificationsRepo: createFakeNotificationsRepo().repo,
      userNotificationsRepo: createFakeUserNotificationsRepo().repo,
      devicesRepo: createFakeDevicesRepo().repo,
      pushSender: push.sender,
    });
    await handler([
      { id: "job-1", name: "push-send", data: { notificationId: crypto.randomUUID() } },
    ]);
    expect(push.sent).toHaveLength(0);
  });
});
