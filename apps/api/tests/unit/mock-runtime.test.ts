import "../setup";
import { describe, expect, test } from "bun:test";
import { ProblemJsonError } from "@stoplight/prism-http";
import type { CachedFn } from "@/lib/cache";
import { createOperationsCache } from "@/modules/mock-runtime/operations-cache";
import { parsePreferences } from "@/modules/mock-runtime/prefer";
import { mapRequest } from "@/modules/mock-runtime/request-mapper";
import {
  MOCK_PROBLEMS,
  problemResponse,
  serializePrismError,
  serializePrismResponse,
} from "@/modules/mock-runtime/response";
import { createRouteResolver } from "@/modules/mock-runtime/route-resolver";
import type { MockRouteRecord } from "@/modules/mocks/mocks.repo";

const NO_QUERY = new URLSearchParams();

describe("parsePreferences", () => {
  test("reads the Prefer header", () => {
    expect(parsePreferences("code=404, example=fido, dynamic=true, seed=abc", NO_QUERY)).toEqual({
      ok: true,
      overrides: { code: 404, exampleKey: "fido", dynamic: true, seed: "abc" },
    });
    expect(parsePreferences('example="with space"', NO_QUERY)).toEqual({
      ok: true,
      overrides: { exampleKey: "with space" },
    });
  });

  test("falls back to __code/__example/__dynamic/__seed only without a Prefer header", () => {
    const query = new URLSearchParams("__code=201&__example=rex&__dynamic=false&__seed=7");
    expect(parsePreferences(undefined, query)).toEqual({
      ok: true,
      overrides: { code: 201, exampleKey: "rex", dynamic: false, seed: "7" },
    });
    expect(parsePreferences("code=500", query)).toEqual({ ok: true, overrides: { code: 500 } });
  });

  test("ignores unrelated preferences and rejects malformed ones", () => {
    expect(parsePreferences("return=minimal", NO_QUERY)).toEqual({ ok: true, overrides: {} });
    expect(parsePreferences("code=abc", NO_QUERY).ok).toBe(false);
    expect(parsePreferences("code=4040", NO_QUERY).ok).toBe(false);
    expect(parsePreferences("dynamic=maybe", NO_QUERY).ok).toBe(false);
    expect(parsePreferences(undefined, new URLSearchParams("__code=x")).ok).toBe(false);
  });
});

describe("mapRequest", () => {
  function input(overrides: Partial<Parameters<typeof mapRequest>[0]> = {}) {
    return {
      method: "POST",
      path: "/pets",
      query: new URLSearchParams("tag=a&tag=b&limit=1&__code=404"),
      headers: new Headers({ "Content-Type": "application/json", Cookie: "s=1", "X-Trace": "t" }),
      bodyText: '{"name":"Rex"}',
      ...overrides,
    };
  }

  test("lowercases the method, keeps repeated query keys as arrays, drops cookies and __ params", () => {
    expect(mapRequest(input())).toEqual({
      method: "post",
      url: { path: "/pets", query: { tag: ["a", "b"], limit: "1" } },
      headers: { "content-type": "application/json", "x-trace": "t" },
      body: { name: "Rex" },
    });
  });

  test("body by content type", () => {
    const json = (bodyText: string, type: string) =>
      mapRequest(input({ bodyText, headers: new Headers({ "content-type": type }) }))?.body;
    expect(json('{"a":1}', "application/vnd.api+json; charset=utf-8")).toEqual({ a: 1 });
    expect(json("{oops", "application/json")).toBe("{oops");
    expect(json("a=1&b=2&b=3", "application/x-www-form-urlencoded")).toEqual({
      a: "1",
      b: ["2", "3"],
    });
    expect(json("plain", "text/plain")).toBe("plain");
    expect(json("", "application/json")).toBeUndefined();
  });

  test("returns null for methods Prism does not model", () => {
    expect(mapRequest(input({ method: "PROPFIND" }))).toBeNull();
  });
});

describe("response serialization", () => {
  test("objects become JSON with a default content-type; set-cookie is stripped", () => {
    expect(
      serializePrismResponse({
        statusCode: 200,
        headers: { "Content-type": "application/json", "Set-Cookie": "a=1", "X-Rate": "5" },
        body: { id: 1 },
      }),
    ).toEqual({
      status: 200,
      headers: { "content-type": "application/json", "x-rate": "5" },
      body: '{"id":1}',
    });
    expect(serializePrismResponse({ statusCode: 201, body: [1] }).headers["content-type"]).toBe(
      "application/json",
    );
  });

  test("strings pass through; empty bodies are null", () => {
    expect(
      serializePrismResponse({
        statusCode: 200,
        headers: { "content-type": "text/plain" },
        body: "hi",
      }).body,
    ).toBe("hi");
    expect(serializePrismResponse({ statusCode: 204, body: "ignored" }).body).toBeNull();
    expect(serializePrismResponse({ statusCode: 200 }).body).toBeNull();
  });

  test("Prism errors become problem+json with additional headers", () => {
    const error = ProblemJsonError.fromTemplate(
      {
        type: "https://stoplight.io/prism/errors#UNAUTHORIZED",
        title: "Invalid security scheme used",
        status: 401,
      },
      "no credentials",
      { headers: { "WWW-Authenticate": "Bearer" } },
    );
    const serialized = serializePrismError(error);
    expect(serialized.status).toBe(401);
    expect(serialized.headers).toEqual({
      "www-authenticate": "Bearer",
      "content-type": "application/problem+json",
    });
    const body = JSON.parse(serialized.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      title: "Invalid security scheme used",
      status: 401,
      detail: "no credentials",
    });
    expect(body.headers).toBeUndefined();
  });

  test("errors without a status are 500", () => {
    expect(serializePrismError(new Error("boom")).status).toBe(500);
  });

  test("our own problems", () => {
    const serialized = problemResponse(MOCK_PROBLEMS.notFound, { "x-extra": "1" });
    expect(serialized.status).toBe(404);
    expect(serialized.headers).toEqual({
      "x-extra": "1",
      "content-type": "application/problem+json",
    });
    expect(JSON.parse(serialized.body ?? "{}")).toEqual({
      type: "https://mockyard.dev/errors#NOT_FOUND",
      title: "Mock not found",
      status: 404,
      detail: "No mock is published at this URL.",
    });
    expect(MOCK_PROBLEMS.paused).toMatchObject({
      title: "Mock paused",
      status: 503,
      detail: "This mock is paused. Requests return 503 until it is resumed.",
    });
  });
});

describe("createOperationsCache", () => {
  test("single-flight: concurrent misses share one load", async () => {
    const loads: string[] = [];
    const { promise: pending, resolve: release } = Promise.withResolvers<string>();
    const cache = createOperationsCache<string>({
      max: 10,
      load: (key) => {
        loads.push(key);
        return pending;
      },
    });
    const both = Promise.all([cache.get("v1"), cache.get("v1")]);
    release("ops");
    expect(await both).toEqual(["ops", "ops"]);
    expect(loads).toEqual(["v1"]);
  });

  test("evicts the least recently used entry past max", async () => {
    const loads: string[] = [];
    const cache = createOperationsCache<string>({
      max: 2,
      load: async (key) => {
        loads.push(key);
        return key;
      },
    });
    for (const key of ["a", "b", "a", "c", "a", "b"]) await cache.get(key);
    expect(loads).toEqual(["a", "b", "c", "b"]);
    expect(cache.size).toBe(2);
  });

  test("failed loads are not cached", async () => {
    let attempt = 0;
    const cache = createOperationsCache<string>({
      max: 2,
      load: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("db down");
        return "ok";
      },
    });
    await expect(cache.get("v")).rejects.toThrow("db down");
    expect(await cache.get("v")).toBe("ok");
  });
});

describe("createRouteResolver", () => {
  const route: MockRouteRecord = {
    mockId: "m1",
    liveVersionId: "v1",
    status: "running",
    responseMode: "static",
    validateRequests: true,
    cors: true,
  };

  test("cache-aside under cache:mocks:route:{ws}/{slug} for 60 s", async () => {
    const calls: { key: string; ttl: number }[] = [];
    const cached: CachedFn = (key, ttl, fn) => {
      calls.push({ key, ttl });
      return fn();
    };
    const lookups: string[] = [];
    const resolver = createRouteResolver({
      mocksRepo: {
        findRoute: async (ws, slug) => {
          lookups.push(`${ws}/${slug}`);
          return slug === "pets" ? route : null;
        },
      },
      cached,
    });
    expect(await resolver.resolve("jane", "pets")).toEqual(route);
    expect(await resolver.resolve("jane", "nope")).toBeNull();
    expect(calls).toEqual([
      { key: "cache:mocks:route:jane/pets", ttl: 60 },
      { key: "cache:mocks:route:jane/nope", ttl: 60 },
    ]);
    expect(lookups).toEqual(["jane/pets", "jane/nope"]);
  });

  test("never builds a key (or queries) for non-slug input", async () => {
    const resolver = createRouteResolver({
      mocksRepo: {
        findRoute: async () => {
          throw new Error("must not query");
        },
      },
      cached: () => {
        throw new Error("must not cache");
      },
    });
    expect(await resolver.resolve("jane", "a*b")).toBeNull();
    expect(await resolver.resolve("Jane", "pets")).toBeNull();
  });
});
