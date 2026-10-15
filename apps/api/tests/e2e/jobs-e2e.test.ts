import "../setup";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PgBoss } from "pg-boss";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { createPool } from "@/db/client";
import * as schema from "@/db/schema";
import { createBoss, createEnqueue } from "@/jobs/boss";
import type { WelcomeEmailJob } from "@/jobs/types";
import { registerWelcomeEmailWorker, WELCOME_EMAIL_QUEUE } from "@/jobs/workers/welcome-email";
import { createAuthService } from "@/modules/auth/auth.service";
import type { GoogleIdClaims, GoogleTokenVerifier } from "@/modules/auth/google-token";
import { createRefreshTokenRepo } from "@/modules/auth/refresh-token.repo";
import { createUserRepo } from "@/modules/users/users.repo";
import { createUsersService } from "@/modules/users/users.service";
import { prepareTestDatabase } from "../helpers/test-db";

// Phase 6 acceptance: a first-time Google sign-in results in the worker
// processing the welcome-email job; a failing handler retries and then lands
// in pg-boss's failed state. Runs against the compose Postgres — pg-boss
// installs its own `pgboss` schema alongside the app tables.
//
// Own pool/boss per test file (and per test for boss): db.test.ts closes the
// shared pool, and a leftover worker from one test would steal jobs from the
// next.
await prepareTestDatabase();

const pool = createPool(env.DATABASE_URL);
const db = drizzle(pool, { schema });

// Fast polling so retries land within the test timeout; production uses
// pg-boss defaults.
const FAST_POLL = { pollingIntervalSeconds: 0.5 };

let boss: PgBoss | null = null;
const createdEmails: string[] = [];

let googleVerifierResult: GoogleIdClaims | Error = new Error("google verifier not stubbed");
const googleTokenVerifier: GoogleTokenVerifier = {
  async verify() {
    if (googleVerifierResult instanceof Error) throw googleVerifierResult;
    return googleVerifierResult;
  },
};

async function startTestBoss(): Promise<PgBoss> {
  // Dedicated schema: pg-boss queues are shared work — a dev server running
  // in-process workers against the default `pgboss` schema would steal (and
  // complete) this suite's jobs. Isolating the schema keeps the test
  // deterministic no matter what else is connected to the database.
  boss = createBoss(env.DATABASE_URL, { schema: "pgboss_test", __test__enableSpies: true });
  await boss.start();
  // Drop jobs (and stored queue options) left over from previous runs.
  await boss.deleteQueue(WELCOME_EMAIL_QUEUE);
  return boss;
}

afterEach(async () => {
  if (boss) {
    await boss.stop({ graceful: false, close: true, timeout: 5_000 });
    boss = null;
  }
  for (const email of createdEmails.splice(0)) {
    await db.delete(schema.users).where(eq(schema.users.email, email));
  }
});

afterAll(async () => {
  await pool.end({ timeout: 5 });
});

function createTestApp(bossInstance: PgBoss) {
  const userRepo = createUserRepo(db);
  return createApp({
    authService: createAuthService({
      userRepo,
      refreshTokenRepo: createRefreshTokenRepo(db),
      enqueue: createEnqueue(bossInstance),
      googleTokenVerifier,
      jwtSecret: env.JWT_SECRET,
      accessTtlSeconds: 900,
      refreshTtlSeconds: 3_600,
    }),
    usersService: createUsersService({ userRepo }),
  });
}

describe("Phase 6 acceptance: background jobs", () => {
  test("a first-time Google sign-in results in the worker processing the welcome-email job", async () => {
    const testBoss = await startTestBoss();
    const processed: WelcomeEmailJob[] = [];
    await registerWelcomeEmailWorker(testBoss, {
      sendWelcomeEmail: async (job) => {
        processed.push(job);
      },
      workOptions: FAST_POLL,
    });
    const spy = testBoss.getSpy<WelcomeEmailJob>(WELCOME_EMAIL_QUEUE);

    const app = createTestApp(testBoss);
    const email = `phase6-e2e-${crypto.randomUUID()}@example.com`;
    createdEmails.push(email);

    googleVerifierResult = {
      sub: `google-jobs-e2e-${crypto.randomUUID()}`,
      email,
      email_verified: true,
    };
    const res = await app.request("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "fake-but-verified" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { user: { id: string } } };

    const job = await spy.waitForJob((data) => data.email === email, "completed");
    expect(job.data).toEqual({ userId: body.data.user.id, email });
    expect(processed).toContainEqual({ userId: body.data.user.id, email });
  }, 20_000);

  test("a failing handler retries, then the job lands in the failed state", async () => {
    const testBoss = await startTestBoss();
    let attempts = 0;
    await registerWelcomeEmailWorker(testBoss, {
      sendWelcomeEmail: async () => {
        attempts += 1;
        throw new Error("smtp is on fire");
      },
      // Tiny retry budget/delay so the terminal state arrives in seconds.
      queueOptions: { retryLimit: 2, retryDelay: 0, retryBackoff: false },
      workOptions: FAST_POLL,
    });
    const spy = testBoss.getSpy<WelcomeEmailJob>(WELCOME_EMAIL_QUEUE);

    const enqueue = createEnqueue(testBoss);
    const jobId = await enqueue("welcome-email", {
      userId: crypto.randomUUID(),
      email: "doomed@example.com",
    });
    if (!jobId) throw new Error("job was not enqueued");

    // The spy only reports "failed" once retries are exhausted.
    await spy.waitForJobWithId(jobId, "failed");
    expect(attempts).toBe(3); // 1 initial attempt + retryLimit 2

    const [job] = await testBoss.findJobs(WELCOME_EMAIL_QUEUE, { id: jobId });
    expect(job?.state).toBe("failed");
    expect(job?.retryCount).toBe(2);
  }, 20_000);
});
