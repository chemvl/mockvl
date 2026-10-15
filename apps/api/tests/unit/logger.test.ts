import "../setup";
import { describe, expect, test } from "bun:test";
import { AppError } from "@/lib/errors";
import { createLogger, redactSecrets } from "@/lib/logger";

describe("redactSecrets", () => {
  test("redacts authorization and cookie fields case-insensitively", () => {
    const result = redactSecrets({
      Authorization: "Bearer abc",
      cookie: "session=xyz",
      COOKIE: "other=1",
      path: "/health",
    });

    expect(result).toEqual({
      Authorization: "[Redacted]",
      cookie: "[Redacted]",
      COOKIE: "[Redacted]",
      path: "/health",
    });
  });

  test("redacts *_KEY, *_SECRET, *_TOKEN and password fields", () => {
    const result = redactSecrets({
      RESEND_API_KEY: "k",
      client_secret: "s",
      refresh_token: "t",
      password: "p",
      keyboard: "not a secret",
    });

    expect(result).toEqual({
      RESEND_API_KEY: "[Redacted]",
      client_secret: "[Redacted]",
      refresh_token: "[Redacted]",
      password: "[Redacted]",
      keyboard: "not a secret",
    });
  });

  test("redacts hyphenated header names and camelCase variants", () => {
    const result = redactSecrets({
      "x-api-key": "k",
      "x-auth-token": "t",
      apiKey: "k2",
      refreshToken: "t2",
      monkey: "safe",
      token: "not matched by the *_TOKEN convention",
    });

    expect(result).toEqual({
      "x-api-key": "[Redacted]",
      "x-auth-token": "[Redacted]",
      apiKey: "[Redacted]",
      refreshToken: "[Redacted]",
      monkey: "safe",
      token: "not matched by the *_TOKEN convention",
    });
  });

  test("recurses into nested objects and arrays", () => {
    const result = redactSecrets({
      req: { headers: { authorization: "Bearer abc", accept: "*/*" } },
      items: [{ api_key: "k1" }, { name: "safe" }],
    });

    expect(result).toEqual({
      req: { headers: { authorization: "[Redacted]", accept: "*/*" } },
      items: [{ api_key: "[Redacted]" }, { name: "safe" }],
    });
  });

  test("does not mutate the input", () => {
    const input = { authorization: "Bearer abc", nested: { my_token: "t" } };

    redactSecrets(input);

    expect(input.authorization).toBe("Bearer abc");
    expect(input.nested.my_token).toBe("t");
  });

  test("leaves primitives and non-plain objects alone", () => {
    expect(redactSecrets("hello")).toBe("hello");
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
    const date = new Date(0);
    expect(redactSecrets(date)).toBe(date);
  });

  test("stops at a maximum depth instead of recursing forever", () => {
    type Deep = { child?: Deep };
    const root: Deep = {};
    let cursor = root;
    for (let i = 0; i < 20; i++) {
      cursor.child = {};
      cursor = cursor.child;
    }

    const result = redactSecrets(root);
    expect(JSON.stringify(result)).toContain("[MaxDepth]");
  });
});

describe("createLogger", () => {
  function captureLogger() {
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      destination: {
        write(msg: string) {
          lines.push(msg);
        },
      },
    });
    return { logger, lines };
  }

  test("redacts sensitive fields in the emitted JSON line", () => {
    const { logger, lines } = captureLogger();

    logger.info({ authorization: "Bearer abc", api_key: "k", path: "/x" }, "req");

    const line = JSON.parse(lines[0] ?? "{}");
    expect(line.authorization).toBe("[Redacted]");
    expect(line.api_key).toBe("[Redacted]");
    expect(line.path).toBe("/x");
  });

  test("redacts sensitive data carried on logged errors (err serializer path)", () => {
    const { logger, lines } = captureLogger();
    const err = new AppError("UPSTREAM_ERROR", 502, "provider call failed", {
      api_key: "sk-live-12345",
      password: "hunter2",
      endpoint: "/v1/things",
    });

    logger.error({ err, requestId: "r-1" }, "unhandled error");

    const raw = lines[0] ?? "";
    const line = JSON.parse(raw);
    expect(line.err.message).toBe("provider call failed");
    expect(line.err.details.api_key).toBe("[Redacted]");
    expect(line.err.details.password).toBe("[Redacted]");
    expect(line.err.details.endpoint).toBe("/v1/things");
    expect(raw).not.toContain("sk-live-12345");
    expect(raw).not.toContain("hunter2");
  });
});
