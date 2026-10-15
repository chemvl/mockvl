import "../setup";

import { afterAll, describe, expect, mock, test } from "bun:test";
import { createEnqueue, getBoss, startBoss, stopBoss } from "@/jobs/boss";
import { createWelcomeEmailHandler, WELCOME_EMAIL_QUEUE } from "@/jobs/workers/welcome-email";
import { prepareTestDatabase } from "../helpers/test-db";

// startBoss() connects to the compose Postgres and installs the pgboss schema
// into the test database, which prepareTestDatabase() creates if missing.
await prepareTestDatabase();

describe("getBoss", () => {
  test("throws when pg-boss has not been started", () => {
    expect(() => getBoss()).toThrow("pg-boss is not started");
  });
});

describe("startBoss singleton", () => {
  // Needs the compose Postgres: start() connects and installs the pgboss schema.
  afterAll(async () => {
    await stopBoss();
  });

  test("concurrent callers share one startup and one instance", async () => {
    const first = startBoss();
    const second = startBoss();

    // The second caller must await the SAME startup — if it got its own
    // resolved promise it could observe a boss that has not started yet.
    expect(second).toBe(first);

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(getBoss()).toBe(a);
  });

  test("stopBoss resets the singleton so getBoss throws again", async () => {
    await startBoss();
    await stopBoss();
    expect(() => getBoss()).toThrow("pg-boss is not started");
  });
});

describe("createEnqueue", () => {
  test("delegates to boss.send and returns the job id", async () => {
    const send = mock(() => Promise.resolve("job-1"));
    const enqueue = createEnqueue({ send });

    const jobId = await enqueue("welcome-email", {
      userId: "5f0b6f9e-8c6a-4b7e-9c1d-2a3b4c5d6e7f",
      email: "new@example.com",
    });

    expect(jobId).toBe("job-1");
    expect(send).toHaveBeenCalledWith(
      "welcome-email",
      { userId: "5f0b6f9e-8c6a-4b7e-9c1d-2a3b4c5d6e7f", email: "new@example.com" },
      undefined,
    );
  });

  test("passes send options through", async () => {
    const send = mock(() => Promise.resolve(null));
    const enqueue = createEnqueue({ send });

    await enqueue(
      "welcome-email",
      { userId: "5f0b6f9e-8c6a-4b7e-9c1d-2a3b4c5d6e7f", email: "new@example.com" },
      { startAfter: 5 },
    );

    expect(send).toHaveBeenCalledWith(
      "welcome-email",
      { userId: "5f0b6f9e-8c6a-4b7e-9c1d-2a3b4c5d6e7f", email: "new@example.com" },
      { startAfter: 5 },
    );
  });
});

describe("welcome-email worker", () => {
  const validJob = {
    userId: "5f0b6f9e-8c6a-4b7e-9c1d-2a3b4c5d6e7f",
    email: "new@example.com",
  };

  test("queue name matches the job registry", () => {
    expect(WELCOME_EMAIL_QUEUE).toBe("welcome-email");
  });

  test("handler dispatches each job in the batch", async () => {
    const sendWelcomeEmail = mock(() => Promise.resolve());
    const handler = createWelcomeEmailHandler({ sendWelcomeEmail });

    await handler([
      { id: "a", name: WELCOME_EMAIL_QUEUE, data: validJob },
      { id: "b", name: WELCOME_EMAIL_QUEUE, data: { ...validJob, email: "other@example.com" } },
    ]);

    expect(sendWelcomeEmail).toHaveBeenCalledTimes(2);
    expect(sendWelcomeEmail).toHaveBeenCalledWith(validJob);
    expect(sendWelcomeEmail).toHaveBeenCalledWith({ ...validJob, email: "other@example.com" });
  });

  test("handler rejects a malformed payload so pg-boss can retry/fail it", async () => {
    const sendWelcomeEmail = mock(() => Promise.resolve());
    const handler = createWelcomeEmailHandler({ sendWelcomeEmail });

    await expect(
      handler([{ id: "a", name: WELCOME_EMAIL_QUEUE, data: { email: 42 } }]),
    ).rejects.toThrow();
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  test("default handler (log-only) resolves without a delivery dependency", async () => {
    const handler = createWelcomeEmailHandler();

    await expect(
      handler([{ id: "a", name: WELCOME_EMAIL_QUEUE, data: validJob }]),
    ).resolves.toBeUndefined();
  });
});
