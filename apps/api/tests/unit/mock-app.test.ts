import "../setup";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { IHttpOperation } from "@stoplight/types";
import { createMockApp, parseMockPath } from "@/modules/mock-runtime/mock-app";
import { createOperationsCache } from "@/modules/mock-runtime/operations-cache";
import type { OverrideStore } from "@/modules/mock-runtime/override-store";
import type { MockRoute } from "@/modules/mock-runtime/route-resolver";
import { loadOperations } from "@/modules/mocks/import/operations";
import { parseSchemaContent } from "@/modules/mocks/import/parse";

const petstore = await Bun.file(
  join(import.meta.dir, "../fixtures/schemas/petstore-3.0.yaml"),
).text();

// Every operation requires a bearer token or an API-key header.
const securedSpec = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Secured", version: "1" },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
  },
  security: [{ bearerAuth: [] }, { apiKey: [] }],
  paths: {
    "/profile": {
      get: {
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { example: { name: "Jane" } } },
          },
        },
      },
    },
  },
});

// Defines a 422, so a failed validation is a Right 422 (with error-severity
// input diagnostics) rather than Prism's own Left problem.
const validatedSpec = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Validated", version: "1" },
  paths: {
    "/items/{id}": {
      get: {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "200": { description: "ok", content: { "application/json": { example: { id: 1 } } } },
          "422": {
            description: "bad",
            content: { "application/json": { example: { error: "bad id" } } },
          },
        },
      },
    },
  },
});

// Path parameters whose values are comma lists (Prism's `simple` style), plus
// a template with a literal comma that must keep routing.
const commaPathSpec = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Comma paths", version: "1" },
  paths: Object.fromEntries(
    (
      [
        ["/param/{keys}", "keys", { type: "array", items: { type: "string" } }],
        ["/ids/{ids}", "ids", { type: "array", items: { type: "integer" } }],
        ["/names/{name}", "name", { type: "string" }],
        ["/a,b/{id}", "id", { type: "integer" }],
      ] as const
    ).map(([path, name, schema]) => [
      path,
      {
        get: {
          parameters: [{ name, in: "path", required: true, schema }],
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { example: { ok: true } } },
            },
          },
        },
      },
    ]),
  ),
});

const NO_OVERRIDES: OverrideStore = { get: async () => null };

const APP_ORIGIN = "https://app.test";

function buildApp(
  overrides: Partial<MockRoute> = {},
  limit = 1_000,
  schema = petstore,
  store: OverrideStore = NO_OVERRIDES,
) {
  const route: MockRoute = {
    mockId: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a",
    liveVersionId: "v1",
    status: "running",
    responseMode: "static",
    validateRequests: true,
    cors: true,
    ...overrides,
  };
  const recorded: { mockId: string; status: number }[] = [];
  const app = createMockApp({
    resolver: {
      resolve: async (ws, slug) => (ws === "jane" && slug === "pets" ? route : null),
    },
    operations: createOperationsCache<IHttpOperation[]>({
      max: 10,
      load: async () => loadOperations(parseSchemaContent(schema, "p"), "p"),
    }),
    overrides: store,
    usage: {
      async record(mockId, status) {
        recorded.push({ mockId, status });
      },
    },
    rateLimit: { windowMs: 60_000, limit },
    appOrigin: APP_ORIGIN,
  });
  return { app, recorded };
}

describe("parseMockPath", () => {
  test("splits /m/{ws}/{slug}{rest}", () => {
    expect(parseMockPath("/m/jane/pets/pets/1")).toEqual({
      ws: "jane",
      slug: "pets",
      rest: "/pets/1",
    });
    expect(parseMockPath("/m/jane/pets")).toEqual({ ws: "jane", slug: "pets", rest: "/" });
    expect(parseMockPath("/m/jane/pets/")).toEqual({ ws: "jane", slug: "pets", rest: "/" });
    expect(parseMockPath("/m/jane")).toBeNull();
    expect(parseMockPath("/api/x")).toBeNull();
  });
});

describe("createMockApp", () => {
  test("serves the first example with security and CORS headers, and counts it", async () => {
    const { app, recorded } = buildApp();
    const res = await app.request("/m/jane/pets/pets/1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, name: "Rex" });
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("x-request-id")).toBeString();
    expect(recorded).toEqual([{ mockId: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a", status: 200 }]);
  });

  test("Prefer header and __ query overrides", async () => {
    const { app } = buildApp();
    const notFound = await app.request("/m/jane/pets/pets/1", { headers: { prefer: "code=404" } });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ message: "Pet not found" });
    const fido = await app.request("/m/jane/pets/pets/1", { headers: { prefer: "example=fido" } });
    expect(await fido.json()).toEqual({ id: 2, name: "Fido" });
    expect((await app.request("/m/jane/pets/pets/1?__code=404")).status).toBe(404);
    const invalid = await app.request("/m/jane/pets/pets/1", { headers: { prefer: "code=abc" } });
    expect(invalid.status).toBe(422);
    expect(invalid.headers.get("content-type")).toBe("application/problem+json");
  });

  test("request validation on → 422, off → 200", async () => {
    const on = await buildApp().app.request("/m/jane/pets/pets/abc");
    expect(on.status).toBe(422);
    expect(on.headers.get("content-type")).toBe("application/problem+json");
    const off = await buildApp({ validateRequests: false }).app.request("/m/jane/pets/pets/abc");
    expect(off.status).toBe(200);
  });

  test("security requirements in the spec never block a request", async () => {
    const { app } = buildApp({}, 1_000, securedSpec);
    const res = await app.request("/m/jane/pets/profile");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Jane" });
  });

  test("CORS preflight", async () => {
    const res = await buildApp().app.request("/m/jane/pets/pets/1", {
      method: "OPTIONS",
      headers: {
        origin: "https://client.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-foo",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST");
    expect(res.headers.get("access-control-allow-headers")).toBe("x-foo");
    expect(res.headers.get("access-control-max-age")).toBe("600");
  });

  test("cors=false sends no CORS headers to other origins", async () => {
    const res = await buildApp({ cors: false }).app.request("/m/jane/pets/pets/1", {
      headers: { origin: "https://client.test" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  test("cors=false still admits the app's own origin (endpoint preview), without credentials", async () => {
    const { app } = buildApp({ cors: false });
    const preflight = await app.request("/m/jane/pets/pets/1", {
      method: "OPTIONS",
      headers: {
        origin: APP_ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": "prefer",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(preflight.headers.get("access-control-allow-headers")).toBe("prefer");
    expect(preflight.headers.get("vary")).toBe("Origin");

    const res = await app.request("/m/jane/pets/pets/1", { headers: { origin: APP_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("paused mocks answer 503 problem+json", async () => {
    const res = await buildApp({ status: "paused" }).app.request("/m/jane/pets/pets/1");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ title: "Mock paused", status: 503 });
  });

  test("unknown mocks and unknown paths are 404 problems", async () => {
    const { app, recorded } = buildApp();
    const unknownMock = await app.request("/m/jane/nope/pets/1");
    expect(unknownMock.status).toBe(404);
    expect(await unknownMock.json()).toEqual({
      type: "https://mockvl.dev/errors#NOT_FOUND",
      title: "Mock not found",
      status: 404,
      detail: "No mock is published at this URL.",
    });
    expect(unknownMock.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(recorded).toEqual([]);
    const unknownPath = await app.request("/m/jane/pets/nothing-here");
    expect(unknownPath.status).toBe(404);
    expect(((await unknownPath.json()) as { type: string }).type).toContain("NO_PATH_MATCHED");
  });

  test("the mock tier rate-limits per client and mock with a 429 problem", async () => {
    const { app } = buildApp({}, 2);
    await app.request("/m/jane/pets/pets/1");
    await app.request("/m/jane/pets/pets/1");
    const limited = await app.request("/m/jane/pets/pets/1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("content-type")).toBe("application/problem+json");
    expect(limited.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
  });

  test("bodies over 1 MiB are 413 problems", async () => {
    const res = await buildApp().app.request("/m/jane/pets/pets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: "x".repeat(1024 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });
});

describe("response overrides", () => {
  const MOCK_ID = "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a";

  // Answers for "method path code" keys; records every lookup.
  function storeWith(saved: Record<string, string>) {
    const lookups: string[] = [];
    const store: OverrideStore = {
      async get(mockId, key) {
        const id = `${key.method} ${key.path} ${key.code}`;
        lookups.push(`${mockId} ${id}`);
        return saved[id] ?? null;
      },
    };
    return { store, lookups };
  }

  test("the saved text replaces Prism's body for the routed template and negotiated code", async () => {
    const saved = '{\n  "id": 7,\n  "name": "Custom"\n}';
    const { store, lookups } = storeWith({ "get /pets/{id} 200": saved });
    const { app } = buildApp({}, 1_000, petstore, store);

    const res = await app.request("/m/jane/pets/pets/42");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(saved);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-mockvl-override")).toBe("1");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(lookups).toEqual([`${MOCK_ID} get /pets/{id} 200`]);

    // Prefer picks the code first; a code with nothing saved stays Prism's.
    const notFound = await app.request("/m/jane/pets/pets/42", { headers: { prefer: "code=404" } });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ message: "Pet not found" });
    expect(notFound.headers.get("x-mockvl-override")).toBeNull();
    expect(lookups.at(-1)).toBe(`${MOCK_ID} get /pets/{id} 404`);
  });

  test("overrides win over named examples and dynamic mode", async () => {
    const { store } = storeWith({ "get /pets/{id} 200": "[1]" });
    const example = await buildApp({}, 1_000, petstore, store).app.request("/m/jane/pets/pets/1", {
      headers: { prefer: "example=fido" },
    });
    expect(await example.text()).toBe("[1]");
    const dynamic = await buildApp({ responseMode: "dynamic" }, 1_000, petstore, store).app.request(
      "/m/jane/pets/pets/1",
    );
    expect(await dynamic.text()).toBe("[1]");
  });

  test("a request failing validation keeps Prism's response and is never looked up", async () => {
    const { store, lookups } = storeWith({
      "get /items/{id} 200": '{"custom":true}',
      "get /items/{id} 422": '{"custom":true}',
    });
    const invalid = await buildApp({}, 1_000, validatedSpec, store).app.request(
      "/m/jane/pets/items/abc",
    );
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ error: "bad id" });
    expect(invalid.headers.get("x-mockvl-override")).toBeNull();
    expect(lookups).toEqual([]);

    // With request validation off the same request is clean → overridden.
    const off = await buildApp(
      { validateRequests: false },
      1_000,
      validatedSpec,
      store,
    ).app.request("/m/jane/pets/items/abc");
    expect(off.status).toBe(200);
    expect(await off.text()).toBe('{"custom":true}');
  });
});

describe("comma-separated path parameters", () => {
  const request = (path: string) =>
    buildApp({}, 1_000, commaPathSpec).app.request(`/m/jane/pets${path}`);

  test("comma lists are deserialized per the parameter's schema instead of failing", async () => {
    for (const path of ["/param/rule,current,errors", "/ids/1,2", "/names/a,b"]) {
      const res = await request(path);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      expect(await res.json()).toEqual({ ok: true });
    }
  });

  test("an invalid item in a comma list is a 422 problem, not a 500", async () => {
    const res = await request("/ids/1,x");
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  test("literal commas in a path template still route and validate", async () => {
    expect((await request("/a,b/1")).status).toBe(200);
    expect((await request("/a,b/x")).status).toBe(422);
  });
});
