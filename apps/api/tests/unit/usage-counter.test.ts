import "../setup";
import { describe, expect, test } from "bun:test";
import pino from "pino";
import {
  createUsageCounter,
  hourEpochSeconds,
  parseUsageKey,
  type UsageStore,
  usageKey,
} from "@/modules/usage/usage-counter";

const MOCK_ID = "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a";
const AT = new Date("2026-10-07T10:42:13.000Z");
const HOUR = Date.parse("2026-10-07T10:00:00.000Z") / 1000;

function recordingStore() {
  const calls: { key: string; fields: Record<string, number>; ttl: number }[] = [];
  const store: UsageStore = {
    async increment(key, fields, ttl) {
      calls.push({ key, fields, ttl });
    },
  };
  return { store, calls };
}

describe("usage keys", () => {
  test("hour bucket and key format", () => {
    expect(hourEpochSeconds(AT)).toBe(HOUR);
    expect(usageKey(MOCK_ID, AT)).toBe(`usage:mock:${MOCK_ID}:${HOUR}`);
  });

  test("parseUsageKey reads live and in-flight keys", () => {
    expect(parseUsageKey(`usage:mock:${MOCK_ID}:${HOUR}`)).toEqual({
      mockId: MOCK_ID,
      hourEpochSeconds: HOUR,
      flushing: false,
    });
    expect(parseUsageKey(`usage:mock:${MOCK_ID}:${HOUR}:flushing:${MOCK_ID}`)).toEqual({
      mockId: MOCK_ID,
      hourEpochSeconds: HOUR,
      flushing: true,
    });
    expect(parseUsageKey("usage:mock:garbage")).toBeNull();
  });
});

describe("createUsageCounter", () => {
  test("increments requests and the 4xx/5xx buckets with a 2-day TTL", async () => {
    const { store, calls } = recordingStore();
    const counter = createUsageCounter({ store, now: () => AT });
    await counter.record(MOCK_ID, 200);
    await counter.record(MOCK_ID, 404);
    await counter.record(MOCK_ID, 503);
    const key = `usage:mock:${MOCK_ID}:${HOUR}`;
    expect(calls).toEqual([
      { key, fields: { requests: 1 }, ttl: 172_800 },
      { key, fields: { requests: 1, client_errors: 1 }, ttl: 172_800 },
      { key, fields: { requests: 1, server_errors: 1 }, ttl: 172_800 },
    ]);
  });

  test("swallows store failures and logs a warning", async () => {
    const lines: string[] = [];
    const log = pino({ level: "warn" }, { write: (line: string) => lines.push(line) });
    const counter = createUsageCounter({
      store: {
        async increment() {
          throw new Error("redis down");
        },
      },
      log,
    });
    await counter.record(MOCK_ID, 200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("MOCK_USAGE_RECORD_FAILED");
  });
});
