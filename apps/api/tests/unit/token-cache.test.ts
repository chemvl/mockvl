import "../setup";
import { describe, expect, test } from "bun:test";
import { createTokenCache } from "@/clients/token-cache";

// Deterministic clock the tests can move forward.
function makeClock(startMs = 1_000_000) {
  let nowMs = startMs;
  return {
    now: () => new Date(nowMs),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

function makeFetcher(ttlSeconds = 3600) {
  let count = 0;
  const fetchToken = async () => {
    count++;
    return { accessToken: `token-${count}`, expiresInSeconds: ttlSeconds };
  };
  return { fetchToken, calls: () => count };
}

describe("createTokenCache", () => {
  test("fetches a token on first call and caches it while valid", async () => {
    const clock = makeClock();
    const fetcher = makeFetcher();
    const cache = createTokenCache({ fetchToken: fetcher.fetchToken, nowFn: clock.now });

    expect(await cache.getToken()).toBe("token-1");
    expect(await cache.getToken()).toBe("token-1");
    expect(fetcher.calls()).toBe(1);
  });

  test("refreshes transparently within 30s of expiry", async () => {
    const clock = makeClock();
    const fetcher = makeFetcher(60); // expires in 60s
    const cache = createTokenCache({ fetchToken: fetcher.fetchToken, nowFn: clock.now });

    expect(await cache.getToken()).toBe("token-1");

    // 29s in: 31s of life left > 30s skew — still cached.
    clock.advance(29_000);
    expect(await cache.getToken()).toBe("token-1");

    // 31s in: 29s left < 30s skew — refreshed.
    clock.advance(2_000);
    expect(await cache.getToken()).toBe("token-2");
    expect(fetcher.calls()).toBe(2);
  });

  test("concurrent callers share one in-flight fetch (single-flight)", async () => {
    const clock = makeClock();
    let count = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchToken = async () => {
      count++;
      await gate;
      return { accessToken: `token-${count}`, expiresInSeconds: 3600 };
    };
    const cache = createTokenCache({ fetchToken, nowFn: clock.now });

    const [a, b] = [cache.getToken(), cache.getToken()];
    release?.();

    expect(await a).toBe("token-1");
    expect(await b).toBe("token-1");
    expect(count).toBe(1);
  });

  test("a failed fetch is not cached — the next call retries", async () => {
    const clock = makeClock();
    let count = 0;
    const fetchToken = async () => {
      count++;
      if (count === 1) throw new Error("provider down");
      return { accessToken: `token-${count}`, expiresInSeconds: 3600 };
    };
    const cache = createTokenCache({ fetchToken, nowFn: clock.now });

    await expect(cache.getToken()).rejects.toThrow("provider down");
    expect(await cache.getToken()).toBe("token-2");
  });
});
