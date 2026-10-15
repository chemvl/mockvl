import "../setup";
import { describe, expect, test } from "bun:test";
import { createApp } from "@/app";
import { NotFoundError } from "@/lib/errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("GET /health", () => {
  test("always returns 200 with a data envelope", async () => {
    const res = await createApp().request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "ok" } });
  });
});

describe("GET /ready", () => {
  test("returns 200 when every readiness check passes", async () => {
    const app = createApp({ readinessChecks: [{ name: "noop", check: () => {} }] });
    const res = await app.request("/api/ready");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "ready" } });
  });

  test("returns 503 with an error envelope when a check fails", async () => {
    const app = createApp({
      readinessChecks: [
        { name: "db", check: () => Promise.reject(new Error("connection refused")) },
      ],
    });
    const res = await app.request("/api/ready");
    const body = (await res.json()) as {
      error: { code: string; message: string; details: unknown; requestId: string };
    };

    expect(res.status).toBe(503);
    expect(body.error.code).toBe("NOT_READY");
    expect(body.error.details).toEqual([{ name: "db" }]);
    expect(body.error.requestId).toMatch(UUID_PATTERN);
    // internal failure reasons are logged, never returned
    expect(JSON.stringify(body)).not.toContain("connection refused");
  });
});

describe("request id middleware", () => {
  test("generates a UUID and echoes it on the response", async () => {
    const res = await createApp().request("/api/health");

    expect(res.headers.get("x-request-id")).toMatch(UUID_PATTERN);
  });

  test("reuses a well-formed incoming X-Request-Id", async () => {
    const res = await createApp().request("/api/health", {
      headers: { "x-request-id": "my-trace-id-123" },
    });

    expect(res.headers.get("x-request-id")).toBe("my-trace-id-123");
  });

  test("replaces a malformed incoming X-Request-Id", async () => {
    const res = await createApp().request("/api/health", {
      headers: { "x-request-id": "bad!id@with#junk$chars" },
    });

    expect(res.headers.get("x-request-id")).toMatch(UUID_PATTERN);
  });
});

describe("error handling", () => {
  test("unknown routes return a NOT_FOUND envelope with requestId", async () => {
    const res = await createApp().request("/api/nope");
    const body = (await res.json()) as { error: { code: string; requestId: string } };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toMatch(UUID_PATTERN);
  });

  test("thrown AppErrors map to their envelope", async () => {
    const app = createApp();
    app.get("/boom", () => {
      throw new NotFoundError("Widget not found", { id: "42" });
    });
    const res = await app.request("/api/boom");
    const body = (await res.json()) as {
      error: { code: string; message: string; details: unknown; requestId: string };
    };

    expect(res.status).toBe(404);
    expect(body.error).toEqual({
      code: "NOT_FOUND",
      message: "Widget not found",
      details: { id: "42" },
      requestId: expect.stringMatching(UUID_PATTERN),
    });
  });

  test("Hono HTTPExceptions keep their status instead of becoming 500s", async () => {
    const { HTTPException } = await import("hono/http-exception");
    const app = createApp();
    app.get("/too-big", () => {
      throw new HTTPException(413, { message: "Payload too large" });
    });
    const res = await app.request("/api/too-big");
    const body = (await res.json()) as { error: { code: string; requestId: string } };

    expect(res.status).toBe(413);
    expect(body.error.code).toBe("HTTP_ERROR");
    expect(body.error.requestId).toMatch(UUID_PATTERN);
  });

  test("unknown errors return a generic 500 without leaking internals", async () => {
    const app = createApp();
    app.get("/crash", () => {
      throw new Error("secret internal detail");
    });
    const res = await app.request("/api/crash");
    const body = (await res.json()) as { error: { code: string; requestId: string } };

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.requestId).toMatch(UUID_PATTERN);
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });
});
