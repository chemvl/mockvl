import "../setup";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PgBoss } from "pg-boss";
import { createAdminAuthService } from "@/admin/auth/admin-auth.service";
import { createAdminSessionsRepo } from "@/admin/auth/admin-sessions.repo";
import { createAdminUsersRepo } from "@/admin/auth/admin-users.repo";
import type { GoogleClaims, GoogleOAuth } from "@/admin/auth/google";
import { createAdminNotificationsService } from "@/admin/notifications/admin-notifications.service";
import { createApp } from "@/app";
import type { PushMessage } from "@/clients/fcm";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { createBoss, createEnqueue } from "@/jobs/boss";
import { PUSH_SEND_QUEUE, registerPushSendWorker } from "@/jobs/workers/push-send";
import { createAuthService } from "@/modules/auth/auth.service";
import { createRefreshTokenRepo } from "@/modules/auth/refresh-token.repo";
import { createDevicesRepo } from "@/modules/devices/devices.repo";
import { createNotificationsRepo } from "@/modules/notifications/notifications.repo";
import { createUserNotificationsRepo } from "@/modules/notifications/user-notifications.repo";
import { createUserRepo } from "@/modules/users/users.repo";
import { createUsersService } from "@/modules/users/users.service";
import { prepareTestDatabase } from "../helpers/test-db";

// Push notifications acceptance: a mobile user has a device, an admin
// composes and sends a notification, the worker fans out (recording sender —
// no Firebase), and the inbox rows land. Real stack
// against compose Postgres; only Google OAuth and FCM delivery are faked at
// their seams.
await prepareTestDatabase();

const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });
const { adminUsers, users } = schema;

const runTag = crypto.randomUUID();
const EDITOR_EMAIL = `push-e2e-editor-${runTag}@example.com`;
const VIEWER_EMAIL = `push-e2e-viewer-${runTag}@example.com`;

const FAST_POLL = { pollingIntervalSeconds: 0.5 };

let nextClaims: GoogleClaims = {};
const fakeGoogle: GoogleOAuth = {
  createAuthorizationRequest: (hdHint) => {
    const state = crypto.randomUUID();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("hd", hdHint);
    return { state, codeVerifier: crypto.randomUUID(), url };
  },
  exchangeCode: async () => nextClaims,
};

// Repos on this file's own pool (the shared db singleton gets closed by
// db.test.ts's afterAll when the whole suite runs).
const userRepo = createUserRepo(db);
const adminUsersRepo = createAdminUsersRepo(db);
const devicesRepo = createDevicesRepo(db);
const notificationsRepo = createNotificationsRepo(db);
const userNotificationsRepo = createUserNotificationsRepo(db);

const pushedMessages: PushMessage[] = [];
const recordingSender = {
  send: async (message: PushMessage) => {
    pushedMessages.push(message);
    return { ok: true as const };
  },
};

// Dedicated pg-boss schema so a dev server's in-process workers can't steal
// this suite's jobs (same rationale as jobs-e2e.test.ts).
let boss: PgBoss;

function buildApp(bossInstance: PgBoss) {
  const enqueue = createEnqueue(bossInstance);
  return createApp({
    authService: createAuthService({
      userRepo,
      refreshTokenRepo: createRefreshTokenRepo(db),
      enqueue,
      googleTokenVerifier: {
        verify: async () => {
          throw new Error("google sign-in not wired in push e2e");
        },
      },
      jwtSecret: env.JWT_SECRET,
      accessTtlSeconds: 900,
      refreshTtlSeconds: 3_600,
    }),
    usersService: createUsersService({ userRepo }),
    adminAuthService: createAdminAuthService({
      adminUsersRepo,
      adminSessionsRepo: createAdminSessionsRepo(db),
      google: fakeGoogle,
      allowedHd: env.GOOGLE_ALLOWED_HD,
      sessionSecret: env.ADMIN_SESSION_SECRET,
    }),
    adminNotificationsService: createAdminNotificationsService({
      notificationsRepo,
      userNotificationsRepo,
      devicesRepo,
      enqueue,
      cancelJob: async (name, jobId) => {
        await bossInstance.cancel(name, jobId);
      },
      pushSender: recordingSender,
    }),
    rateLimit: {
      auth: { windowMs: 60_000, limit: 1_000 },
      global: { windowMs: 60_000, limit: 10_000 },
    },
  });
}

let app: ReturnType<typeof buildApp>;
let editorCookie: string;
let viewerCookie: string;
let userId: string;
const deviceToken = `fcm-token-${runTag}`;

function cookieValue(res: Response, name: string): string | undefined {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return header?.split(";")[0]?.slice(name.length + 1) || undefined;
}

async function adminLogin(email: string): Promise<string> {
  nextClaims = {
    sub: `google-${email}`,
    email,
    email_verified: true,
    hd: env.GOOGLE_ALLOWED_HD,
    name: "Push E2E Admin",
  };
  const start = await app.request("/api/admin/auth/google");
  const state = cookieValue(start, "admin_oauth_state");
  const verifier = cookieValue(start, "admin_oauth_verifier");
  if (!state || !verifier) throw new Error("start did not set the oauth cookies");
  const callback = await app.request(
    `/api/admin/auth/google/callback?code=fake-code&state=${state}`,
    { headers: { cookie: `admin_oauth_state=${state}; admin_oauth_verifier=${verifier}` } },
  );
  const token = cookieValue(callback, "admin_session");
  if (!token) throw new Error(`login failed for ${email}`);
  return `admin_session=${token}`;
}

function adminHeaders(cookie: string) {
  return {
    cookie,
    "x-requested-with": "XMLHttpRequest",
    "content-type": "application/json",
  };
}

async function pollStatus(id: string, wanted: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.request(`/api/admin/notifications/${id}`, {
      headers: { cookie: editorCookie },
    });
    const body = (await res.json()) as { data: { status: string } };
    if (body.data.status === wanted) return;
    if (Date.now() > deadline) {
      throw new Error(`status never reached ${wanted} (last: ${body.data.status})`);
    }
    await Bun.sleep(250);
  }
}

beforeAll(async () => {
  boss = createBoss(env.DATABASE_URL, { schema: "pgboss_test", __test__enableSpies: true });
  await boss.start();
  await boss.deleteQueue(PUSH_SEND_QUEUE);
  await registerPushSendWorker(boss, {
    notificationsRepo,
    userNotificationsRepo,
    devicesRepo,
    pushSender: recordingSender,
    workOptions: FAST_POLL,
  });

  app = buildApp(boss);

  // Mobile user with one push-enabled device, seeded directly.
  const email = `push-e2e-user-${runTag}@example.com`;
  const [user] = await db.insert(users).values({ email }).returning();
  if (!user) throw new Error("user seed returned no row");
  userId = user.id;
  await db.insert(schema.devices).values({ userId, token: deviceToken, platform: "android" });

  // Admins: first login lands as viewer; promote one to editor.
  editorCookie = await adminLogin(EDITOR_EMAIL);
  const editor = await adminUsersRepo.findByEmail(EDITOR_EMAIL);
  if (!editor) throw new Error("editor admin missing");
  await adminUsersRepo.updateRole(editor.id, "editor");
  editorCookie = await adminLogin(EDITOR_EMAIL);
  viewerCookie = await adminLogin(VIEWER_EMAIL);
});

afterEach(() => {
  pushedMessages.length = 0;
});

afterAll(async () => {
  await boss.stop({ graceful: false, close: true, timeout: 5_000 });
  // Users cascade to devices and user_notifications; admin deletions cascade
  // to their sessions. Notifications rows are removed explicitly.
  await db.delete(schema.notifications);
  await db.delete(users).where(eq(users.id, userId));
  for (const email of [EDITOR_EMAIL, VIEWER_EMAIL]) {
    await db.delete(adminUsers).where(eq(adminUsers.email, email));
  }
  await pool.end({ timeout: 5 });
});

describe("push notifications acceptance", () => {
  test("compose → send → worker fan-out → inbox rows and stats", async () => {
    const create = await app.request("/api/admin/notifications", {
      method: "POST",
      headers: adminHeaders(editorCookie),
      body: JSON.stringify({
        title: "Launch day",
        body: "We are live!",
        deepLink: "/announcements/launch",
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { data: { id: string; status: string } };
    expect(created.data.status).toBe("draft");

    const send = await app.request(`/api/admin/notifications/${created.data.id}/send`, {
      method: "POST",
      headers: adminHeaders(editorCookie),
    });
    expect(send.status).toBe(202);

    await pollStatus(created.data.id, "sent");
    expect(pushedMessages.map((m) => m.token)).toEqual([deviceToken]);
    expect(pushedMessages[0]?.data).toMatchObject({
      notificationId: created.data.id,
      deepLink: "/announcements/launch",
    });

    // Double-send after completion conflicts.
    const resend = await app.request(`/api/admin/notifications/${created.data.id}/send`, {
      method: "POST",
      headers: adminHeaders(editorCookie),
    });
    expect(resend.status).toBe(409);

    // Inbox row lands for the mobile user.
    const inboxRows = await db
      .select()
      .from(schema.userNotifications)
      .where(eq(schema.userNotifications.userId, userId));
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]?.notificationId).toBe(created.data.id);
    expect(inboxRows[0]?.readAt).toBeNull();

    // Admin stats reflect the delivery.
    const stats = await app.request(`/api/admin/notifications/${created.data.id}/stats`, {
      headers: { cookie: editorCookie },
    });
    expect((await stats.json()) as object).toEqual({
      data: {
        targetedDevices: 1,
        sentCount: 1,
        failedCount: 0,
        inboxCount: 1,
        readCount: 0,
      },
    });
  }, 30_000);

  test("scheduled sends fire via startAfter", async () => {
    const create = await app.request("/api/admin/notifications", {
      method: "POST",
      headers: adminHeaders(editorCookie),
      body: JSON.stringify({ title: "Scheduled hello", body: "From the future" }),
    });
    const created = (await create.json()) as { data: { id: string } };

    const scheduledAt = new Date(Date.now() + 1_500).toISOString();
    const scheduleRes = await app.request(`/api/admin/notifications/${created.data.id}/schedule`, {
      method: "POST",
      headers: adminHeaders(editorCookie),
      body: JSON.stringify({ scheduledAt }),
    });
    expect(scheduleRes.status).toBe(200);
    const scheduled = (await scheduleRes.json()) as { data: { status: string } };
    expect(scheduled.data.status).toBe("scheduled");

    await pollStatus(created.data.id, "sent", 20_000);
    expect(pushedMessages.map((m) => m.token)).toEqual([deviceToken]);
  }, 30_000);

  test("canceling a scheduled send keeps it from ever delivering", async () => {
    const create = await app.request("/api/admin/notifications", {
      method: "POST",
      headers: adminHeaders(editorCookie),
      body: JSON.stringify({ title: "Never sent", body: "Withdrawn" }),
    });
    const created = (await create.json()) as { data: { id: string } };

    const scheduledAt = new Date(Date.now() + 2_000).toISOString();
    await app.request(`/api/admin/notifications/${created.data.id}/schedule`, {
      method: "POST",
      headers: adminHeaders(editorCookie),
      body: JSON.stringify({ scheduledAt }),
    });
    const cancel = await app.request(`/api/admin/notifications/${created.data.id}/cancel`, {
      method: "POST",
      headers: adminHeaders(editorCookie),
    });
    expect(cancel.status).toBe(200);

    // Wait past the scheduled time: the status guard must hold at canceled.
    await Bun.sleep(3_500);
    const after = await app.request(`/api/admin/notifications/${created.data.id}`, {
      headers: { cookie: editorCookie },
    });
    expect(((await after.json()) as { data: { status: string } }).data.status).toBe("canceled");
    expect(pushedMessages).toHaveLength(0);
  }, 20_000);

  test("viewers can read but not send", async () => {
    const list = await app.request("/api/admin/notifications", {
      headers: { cookie: viewerCookie },
    });
    expect(list.status).toBe(200);

    const create = await app.request("/api/admin/notifications", {
      method: "POST",
      headers: adminHeaders(viewerCookie),
      body: JSON.stringify({ title: "Nope", body: "Viewer" }),
    });
    expect(create.status).toBe(403);
  });
});
