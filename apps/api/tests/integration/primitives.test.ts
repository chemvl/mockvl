import "../setup";
import { afterAll, describe, expect, test } from "bun:test";
import { ConflictError } from "@/lib/errors";
import { idempotent, withLock } from "@/lib/primitives";
import { closeRedis, createRedis } from "@/lib/redis";

// Integration tests — they require the compose Redis from docker-compose.yml
// to be up (docker compose up -d).

const client = createRedis(String(process.env.REDIS_URL));

// Redis keys persist between runs, so every test key is unique per run.
const runId = crypto.randomUUID();
const key = (name: string) => `test:${runId}:${name}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(async () => {
  await closeRedis(client);
});

describe("withLock", () => {
  test("runs fn and returns its result", async () => {
    const result = await withLock(key("basic"), 5_000, async () => "done", { client });

    expect(result).toBe("done");
  });

  test("mutual exclusion: a concurrent second caller gets ConflictError", async () => {
    let runs = 0;
    const contested = key("contested");
    const work = async () => {
      runs++;
      await sleep(150);
      return runs;
    };

    const [first, second] = await Promise.allSettled([
      withLock(contested, 5_000, work, { client }),
      withLock(contested, 5_000, work, { client }),
    ]);

    const outcomes = [first, second];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(runs).toBe(1);
  });

  test("releases the lock after fn completes so the next caller acquires it", async () => {
    const reusable = key("reusable");

    await withLock(reusable, 5_000, async () => "first", { client });
    const second = await withLock(reusable, 5_000, async () => "second", { client });

    expect(second).toBe("second");
  });

  test("releases the lock when fn throws, and the error propagates", async () => {
    const failing = key("failing");

    await expect(
      withLock(
        failing,
        5_000,
        async () => {
          throw new Error("boom");
        },
        { client },
      ),
    ).rejects.toThrow("boom");

    // Lock must be free again despite the failure.
    await expect(withLock(failing, 5_000, async () => "ok", { client })).resolves.toBe("ok");
  });

  test("token-safe release: A cannot release a lock now held by B", async () => {
    const shared = key("token-safe");

    // A's lock expires (ttl 200ms) while its fn is still running (800ms).
    const a = withLock(shared, 200, () => sleep(800), { client });
    await sleep(450);

    // B acquires the expired lock and holds it long-term.
    const b = withLock(
      shared,
      60_000,
      async () => {
        // Wait for A to finish — its release must NOT delete B's token.
        await a;
        await expect(
          withLock(shared, 1_000, async () => "stolen", { client }),
        ).rejects.toBeInstanceOf(ConflictError);
        return "b-done";
      },
      { client },
    );

    await expect(b).resolves.toBe("b-done");
  });
});

describe("idempotent", () => {
  test("first call runs fn; replay returns the stored result without running fn", async () => {
    let runs = 0;
    const idemKey = key("replay");
    const fn = async () => {
      runs++;
      return { orderId: "o-1", amount: 42 };
    };

    const first = await idempotent(idemKey, 60, fn, { client });
    const replay = await idempotent(idemKey, 60, fn, { client });

    expect(first).toEqual({ orderId: "o-1", amount: 42 });
    expect(replay).toEqual({ orderId: "o-1", amount: 42 });
    expect(runs).toBe(1);
  });

  test("a concurrent duplicate gets ConflictError while the first is pending", async () => {
    const idemKey = key("pending");
    const slow = idempotent(
      idemKey,
      60,
      async () => {
        await sleep(200);
        return "slow-done";
      },
      { client },
    );
    await sleep(50);

    await expect(idempotent(idemKey, 60, async () => "dup", { client })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(slow).resolves.toBe("slow-done");
  });

  test("a failed fn clears the pending marker so a retry can run", async () => {
    let attempts = 0;
    const idemKey = key("retry");

    await expect(
      idempotent(
        idemKey,
        60,
        async () => {
          attempts++;
          throw new Error("first attempt fails");
        },
        { client },
      ),
    ).rejects.toThrow("first attempt fails");

    const retry = await idempotent(
      idemKey,
      60,
      async () => {
        attempts++;
        return "second attempt ok";
      },
      { client },
    );

    expect(retry).toBe("second attempt ok");
    expect(attempts).toBe(2);
  });

  test("the stored result expires with the configured TTL", async () => {
    const idemKey = key("ttl");

    await idempotent(idemKey, 60, async () => "stored", { client });

    const pttl = await client.pttl(`idem:${idemKey}`);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(60_000);
  });
});
