import "../setup";
import { describe, expect, test } from "bun:test";
import { createHttpClient, getUpstreamStatus } from "@/clients/http";
import { UpstreamError } from "@/lib/errors";

// A fetch stub that pops scripted results in order. Each script entry is
// either a Response, an Error to reject with, or "hang" (never settles until
// the abort signal fires — used for timeout tests).
type ScriptEntry = Response | Error | "hang";

function scriptedFetch(script: ScriptEntry[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const entry = script.shift();
    if (entry === undefined) throw new Error("scriptedFetch: script exhausted");
    if (entry === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError")),
        );
      });
    }
    if (entry instanceof Error) return Promise.reject(entry);
    return Promise.resolve(entry);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const instantSleep = () => Promise.resolve();

function makeClient(script: ScriptEntry[], options: Record<string, unknown> = {}) {
  const { fetchFn, calls } = scriptedFetch(script);
  const sleeps: number[] = [];
  const client = createHttpClient({
    name: "example",
    baseUrl: "https://api.example.test",
    fetchFn,
    sleepFn: async (ms: number) => {
      sleeps.push(ms);
    },
    randomFn: () => 0,
    ...options,
  });
  return { client, calls, sleeps };
}

describe("createHttpClient — request basics", () => {
  test("returns the response for a 2xx and builds url from baseUrl + path", async () => {
    const { client, calls } = makeClient([new Response("ok", { status: 200 })]);

    const res = await client.request("/things/1");

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/things/1");
    expect(calls[0]?.init.method).toBe("GET");
  });

  test("sends default headers merged with per-request headers (request wins)", async () => {
    const { client, calls } = makeClient([new Response("ok")], {
      headers: { authorization: "Bearer default-key", "x-client": "starter" },
    });

    await client.request("/things", { headers: { "x-client": "override" } });

    const sent = new Headers(calls[0]?.init.headers);
    expect(sent.get("authorization")).toBe("Bearer default-key");
    expect(sent.get("x-client")).toBe("override");
  });

  test("serializes body as JSON with content-type header", async () => {
    const { client, calls } = makeClient([new Response("ok")]);

    await client.request("/things", { method: "POST", body: { title: "hi" } });

    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ title: "hi" }));
    expect(new Headers(calls[0]?.init.headers).get("content-type")).toBe("application/json");
  });

  test("appends query params to the url", async () => {
    const { client, calls } = makeClient([new Response("ok")]);

    await client.request("/things", { query: { page: "2", q: "a b" } });

    expect(calls[0]?.url).toBe("https://api.example.test/things?page=2&q=a+b");
  });
});

describe("createHttpClient — error mapping", () => {
  test("non-retryable 4xx throws UpstreamError immediately (single attempt)", async () => {
    const { client, calls } = makeClient([new Response("bad", { status: 400 })]);

    const promise = client.request("/things");
    await expect(promise).rejects.toBeInstanceOf(UpstreamError);
    await expect(promise).rejects.toThrow(/example/);
    expect(calls).toHaveLength(1);
  });

  test("UpstreamError carries provider name and upstream status in details", async () => {
    const { client } = makeClient([new Response("nope", { status: 404 })]);

    try {
      await client.request("/things/9");
      throw new Error("expected UpstreamError");
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamError);
      const details = (error as UpstreamError).details as Record<string, unknown>;
      expect(details.provider).toBe("example");
      expect(details.status).toBe(404);
      expect((error as UpstreamError).status).toBe(502);
    }
  });

  test("error details never include request headers or body", async () => {
    const { client } = makeClient([new Response("bad", { status: 500 })], { retries: 0 });

    try {
      await client.request("/things", {
        method: "POST",
        body: { password: "hunter2" },
        headers: { authorization: "Bearer secret-key" },
      });
      throw new Error("expected UpstreamError");
    } catch (error) {
      const serialized = JSON.stringify({
        message: (error as Error).message,
        details: (error as UpstreamError).details,
      });
      expect(serialized).not.toContain("secret-key");
      expect(serialized).not.toContain("hunter2");
      expect(serialized).not.toContain("authorization");
    }
  });

  test("getUpstreamStatus extracts the status from an UpstreamError", async () => {
    const { client } = makeClient([new Response("nope", { status: 404 })]);

    try {
      await client.request("/things/9");
      throw new Error("expected UpstreamError");
    } catch (error) {
      expect(getUpstreamStatus(error)).toBe(404);
    }
    expect(getUpstreamStatus(new Error("plain"))).toBeUndefined();
    expect(getUpstreamStatus(new UpstreamError("no details"))).toBeUndefined();
  });
});

describe("createHttpClient — retries", () => {
  test("retries on 5xx and succeeds on a later attempt", async () => {
    const { client, calls } = makeClient([
      new Response("boom", { status: 500 }),
      new Response("boom", { status: 503 }),
      new Response("ok", { status: 200 }),
    ]);

    const res = await client.request("/things");

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  test("retries on 429", async () => {
    const { client, calls } = makeClient([
      new Response("slow down", { status: 429 }),
      new Response("ok", { status: 200 }),
    ]);

    await client.request("/things");

    expect(calls).toHaveLength(2);
  });

  test("retries on network error", async () => {
    const { client, calls } = makeClient([
      new TypeError("fetch failed"),
      new Response("ok", { status: 200 }),
    ]);

    await client.request("/things");

    expect(calls).toHaveLength(2);
  });

  test("gives up after `retries` extra attempts and throws UpstreamError with last status", async () => {
    const { client, calls } = makeClient([
      new Response("boom", { status: 502 }),
      new Response("boom", { status: 502 }),
      new Response("boom", { status: 503 }),
    ]);

    try {
      await client.request("/things");
      throw new Error("expected UpstreamError");
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamError);
      expect(getUpstreamStatus(error)).toBe(503);
    }
    expect(calls).toHaveLength(3); // 1 initial + retries=2
  });

  test("network error after exhausted retries maps to UpstreamError without status", async () => {
    const { client } = makeClient([new TypeError("fetch failed"), new TypeError("fetch failed")], {
      retries: 1,
    });

    try {
      await client.request("/things");
      throw new Error("expected UpstreamError");
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamError);
      expect(getUpstreamStatus(error)).toBeUndefined();
      const details = (error as UpstreamError).details as Record<string, unknown>;
      expect(details.provider).toBe("example");
    }
  });

  test("backoff is exponential and includes jitter", async () => {
    const { client, sleeps } = makeClient(
      [
        new Response("boom", { status: 500 }),
        new Response("boom", { status: 500 }),
        new Response("ok", { status: 200 }),
      ],
      { randomFn: () => 0.5 },
    );

    await client.request("/things");

    // base 250ms: attempt 0 → 250 * 2^0 + 0.5 * 250 = 375; attempt 1 → 500 + 125 = 625
    expect(sleeps).toEqual([375, 625]);
  });

  test("retries=0 disables retries", async () => {
    const { client, calls } = makeClient([new Response("boom", { status: 500 })], {
      retries: 0,
    });

    await expect(client.request("/things")).rejects.toBeInstanceOf(UpstreamError);
    expect(calls).toHaveLength(1);
  });
});

describe("createHttpClient — timeout", () => {
  test("aborts a hanging request after timeoutMs, retries, then maps to UpstreamError", async () => {
    const { fetchFn, calls } = scriptedFetch(["hang", "hang"]);
    const client = createHttpClient({
      name: "example",
      baseUrl: "https://api.example.test",
      timeoutMs: 20,
      retries: 1,
      fetchFn,
      sleepFn: instantSleep,
      randomFn: () => 0,
    });

    try {
      await client.request("/slow");
      throw new Error("expected UpstreamError");
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as Error).message).toMatch(/timed out/i);
    }
    expect(calls).toHaveLength(2);
  });

  test("timeout recovers when a retry succeeds in time", async () => {
    const { fetchFn, calls } = scriptedFetch(["hang", new Response("ok", { status: 200 })]);
    const client = createHttpClient({
      name: "example",
      baseUrl: "https://api.example.test",
      timeoutMs: 20,
      retries: 1,
      fetchFn,
      sleepFn: instantSleep,
      randomFn: () => 0,
    });

    const res = await client.request("/slow");

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });
});

describe("createHttpClient — credential-safety hardening", () => {
  test("rejects an absolute path that would leave baseUrl's origin", async () => {
    const { client, calls } = makeClient([new Response("ok")]);

    await expect(client.request("https://evil.test/steal")).rejects.toThrow(/must stay on|origin/i);
    expect(calls).toHaveLength(0); // never fetched — the key never left
  });

  test("rejects a protocol-relative path that would leave baseUrl's origin", async () => {
    const { client, calls } = makeClient([new Response("ok")]);

    await expect(client.request("//evil.test/steal")).rejects.toThrow(/must stay on|origin/i);
    expect(calls).toHaveLength(0);
  });
});

describe("createHttpClient — response body hygiene", () => {
  test("cancels the body of failed responses so connections are not leaked", async () => {
    let cancelled = 0;
    const failedBody = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("boom"));
        },
        cancel() {
          cancelled++;
        },
      });
    const { client } = makeClient(
      [new Response(failedBody(), { status: 500 }), new Response(failedBody(), { status: 400 })],
      { retries: 1 },
    );

    await expect(client.request("/things")).rejects.toBeInstanceOf(UpstreamError);
    expect(cancelled).toBe(2); // both the retried 500 and the final 400
  });

  test("json() times out when headers arrive but the body stalls", async () => {
    // Emulates real fetch semantics: headers land immediately, the body
    // stream never produces data and errors with AbortError when the
    // request's signal aborts.
    const calls: RequestInit[] = [];
    const fetchFn = ((_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {});
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("The operation was aborted", "AbortError")),
          );
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;

    const client = createHttpClient({
      name: "example",
      baseUrl: "https://api.example.test",
      timeoutMs: 20,
      retries: 1,
      fetchFn,
      sleepFn: instantSleep,
      randomFn: () => 0,
    });

    const promise = client.json("/slow-body");
    await expect(promise).rejects.toBeInstanceOf(UpstreamError);
    await expect(promise).rejects.toThrow(/timed out/i);
    expect(calls).toHaveLength(2); // a stalled body is transient — it retries
  });
});

describe("createHttpClient — json helper", () => {
  test("json() parses a JSON response body", async () => {
    const { client } = makeClient([Response.json({ id: "1", title: "hello" })]);

    const data = await client.json("/things/1");

    expect(data).toEqual({ id: "1", title: "hello" });
  });

  test("json() maps a non-JSON body to UpstreamError", async () => {
    const { client } = makeClient([new Response("<html>oops</html>", { status: 200 })]);

    const promise = client.json("/things/1");
    await expect(promise).rejects.toBeInstanceOf(UpstreamError);
    await expect(promise).rejects.toThrow(/invalid json/i);
  });
});
