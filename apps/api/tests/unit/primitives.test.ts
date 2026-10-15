import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { createLogger } from "@/lib/logger";
import { idempotent, withLock } from "@/lib/primitives";
import { closeRedis, createRedis } from "@/lib/redis";

// Fail-closed behavior needs a *dead* Redis, so no external service is
// involved — port 1 refuses connections immediately.
const deadRedis = createRedis("redis://127.0.0.1:1");

const silentLogger = createLogger({ level: "silent" });

afterAll(async () => {
  await closeRedis(deadRedis);
});

describe("withLock with Redis down (fail closed)", () => {
  test("rejects without running fn", async () => {
    let ran = false;

    const promise = withLock(
      "unit-lock",
      1_000,
      async () => {
        ran = true;
      },
      { client: deadRedis, log: silentLogger },
    );

    await expect(promise).rejects.toThrow();
    expect(ran).toBe(false);
  });
});

describe("idempotent with Redis down (fail closed)", () => {
  test("rejects without running fn", async () => {
    let ran = false;

    const promise = idempotent(
      "unit-idem",
      60,
      async () => {
        ran = true;
        return { ok: true };
      },
      { client: deadRedis, log: silentLogger },
    );

    await expect(promise).rejects.toThrow();
    expect(ran).toBe(false);
  });
});
