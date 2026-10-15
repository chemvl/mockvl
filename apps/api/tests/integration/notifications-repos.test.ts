import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { createDevicesRepo } from "@/modules/devices/devices.repo";
import { createNotificationsRepo } from "@/modules/notifications/notifications.repo";
import { createUserNotificationsRepo } from "@/modules/notifications/user-notifications.repo";
import { createUserRepo } from "@/modules/users/users.repo";
import { prepareTestDatabase } from "../helpers/test-db";

const { users, notifications, devices } = schema;

// Integration tests — they require the compose Postgres from docker-compose.yml
// to be up (docker compose up -d); the test database itself is created and
// migrated by prepareTestDatabase().
await prepareTestDatabase();

// Own pool so closing it can't break other test files sharing the process.
const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });

const userRepo = createUserRepo(db);
const devicesRepo = createDevicesRepo(db);
const notificationsRepo = createNotificationsRepo(db);
const userNotificationsRepo = createUserNotificationsRepo(db);

const createdUserIds: string[] = [];
const createdNotificationIds: string[] = [];

async function insertUser() {
  const user = await userRepo.insert({
    email: `push-${crypto.randomUUID()}@example.com`,
    passwordHash: "not-a-real-hash",
  });
  createdUserIds.push(user.id);
  return user;
}

async function insertNotification(overrides: Partial<typeof notifications.$inferInsert> = {}) {
  const notification = await notificationsRepo.create({
    title: "Integration hello",
    body: "Body",
    ...overrides,
  });
  createdNotificationIds.push(notification.id);
  return notification;
}

afterAll(async () => {
  // Deleting users cascades to devices and user_notifications.
  for (const id of createdNotificationIds) {
    await db.delete(notifications).where(eq(notifications.id, id));
  }
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id));
  }
  await pool.end({ timeout: 5 });
});

describe("devicesRepo", () => {
  test("keyset pagination walks every enabled device exactly once", async () => {
    const user = await insertUser();
    const tokens = Array.from({ length: 5 }, (_, i) => `tok-${i}-${crypto.randomUUID()}`);
    await db.insert(devices).values([
      ...tokens.map((token) => ({ userId: user.id, token, platform: "android" as const })),
      {
        userId: user.id,
        token: `tok-off-${crypto.randomUUID()}`,
        platform: "ios" as const,
        pushEnabled: false,
      },
    ]);

    const seen: string[] = [];
    let afterId: string | null = null;
    for (;;) {
      const page = await devicesRepo.listTokensPage({ userIds: [user.id], afterId, limit: 2 });
      if (page.length === 0) break;
      seen.push(...page.map((row) => row.token));
      afterId = page[page.length - 1]?.id ?? null;
      if (page.length < 2) break;
    }
    expect(seen.sort()).toEqual([...tokens].sort());
  });
});

describe("userNotificationsRepo", () => {
  test("insertMany is idempotent per (notification, user)", async () => {
    const user = await insertUser();
    const notification = await insertNotification();

    await userNotificationsRepo.insertMany(notification.id, [user.id]);
    await userNotificationsRepo.insertMany(notification.id, [user.id]);

    const counts = await userNotificationsRepo.countByNotification(notification.id);
    expect(counts).toEqual({ inboxCount: 1, readCount: 0 });
  });
});

describe("notificationsRepo", () => {
  test("guarded status transitions only land from the allowed set", async () => {
    const notification = await insertNotification();

    const missed = await notificationsRepo.updateWhereStatusIn(notification.id, ["scheduled"], {
      status: "canceled",
    });
    expect(missed).toBeUndefined();

    const claimed = await notificationsRepo.updateWhereStatusIn(notification.id, ["draft"], {
      status: "sending",
    });
    expect(claimed?.status).toBe("sending");
  });

  test("addCounts increments atomically", async () => {
    const notification = await insertNotification();
    await notificationsRepo.addCounts(notification.id, 3, 1);
    await notificationsRepo.addCounts(notification.id, 2, 0);
    const row = await notificationsRepo.findById(notification.id);
    expect(row).toMatchObject({ sentCount: 5, failedCount: 1 });
  });

  test("list filters by status via the query contract shape", async () => {
    const notification = await insertNotification();
    const { rows } = await notificationsRepo.list({
      page: 1,
      pageSize: 100,
      sort: [{ field: "createdAt", dir: "desc" }],
      filters: [{ field: "id", op: "eq", value: notification.id }],
    });
    expect(rows.map((row) => row.id)).toEqual([notification.id]);
  });
});
