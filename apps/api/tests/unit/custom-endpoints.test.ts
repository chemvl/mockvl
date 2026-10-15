import "../setup";
import { describe, expect, test } from "bun:test";
import { type CustomEndpoint, defaultServedStatus } from "@starter/schemas";
import { AppError } from "@/lib/errors";
import { generateOpenApi } from "@/modules/mocks/custom/generate-openapi";
import { inferSchema } from "@/modules/mocks/custom/infer-schema";
import {
  assertNoDuplicate,
  normalizeEndpoint,
  pathKey,
  pathParams,
} from "@/modules/mocks/custom/validate-endpoint";
import { importSchemaContent } from "@/modules/mocks/import/importer";

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "returned";
  } catch (error) {
    return error instanceof AppError ? error.code : `non-app-error: ${String(error)}`;
  }
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
    return "returned";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const endpoint = (overrides: Partial<CustomEndpoint> = {}): CustomEndpoint => ({
  kind: "http",
  method: "get",
  path: "/users/{id}",
  responses: [{ status: 200, headers: {}, body: '{"id":1}' }],
  ...overrides,
});

describe("inferSchema", () => {
  test("objects list every key as required, sorted", () => {
    expect(inferSchema({ b: "x", a: 1.5, c: true })).toEqual({
      type: "object",
      properties: { a: { type: "number" }, b: { type: "string" }, c: { type: "boolean" } },
      required: ["a", "b", "c"],
    });
  });

  test("integers, arrays from the first item, empty arrays and null", () => {
    expect(
      inferSchema({ id: 7, tags: [], owner: null, items: [{ n: 1 }, { n: "ignored" }] }),
    ).toEqual({
      type: "object",
      properties: {
        id: { type: "integer" },
        items: {
          type: "array",
          items: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
        },
        owner: {},
        tags: { type: "array", items: {} },
      },
      required: ["id", "items", "owner", "tags"],
    });
  });

  test("top-level scalars", () => {
    expect(inferSchema("x")).toEqual({ type: "string" });
    expect(inferSchema(null)).toEqual({});
  });
});

describe("generateOpenApi", () => {
  const users = endpoint({
    summary: "Get user",
    responses: [
      { status: 404, headers: {}, body: '{"error":"missing"}' },
      { status: 200, headers: { "x-total-count": "3" }, body: '{"id":7,"name":"Ann"}' },
    ],
  });
  const create = endpoint({
    method: "post",
    path: "/users",
    responses: [{ status: 201, headers: { location: "/users/1" }, body: null }],
  });

  test("deterministic: endpoint order doesn't change the bytes", () => {
    expect(generateOpenApi([users, create], "Users")).toBe(
      generateOpenApi([create, users], "Users"),
    );
  });

  test("params, inferred schemas, examples, headers and empty bodies", () => {
    const doc = JSON.parse(generateOpenApi([users, create], "Users"));
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual({ title: "Users", version: "1.0.0" });
    expect(Object.keys(doc.paths)).toEqual(["/users", "/users/{id}"]);
    const get = doc.paths["/users/{id}"].get;
    expect(get.summary).toBe("Get user");
    expect(get.parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ]);
    expect(get.responses["200"]).toEqual({
      description: "OK",
      headers: { "x-total-count": { schema: { type: "string" }, example: "3" } },
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { id: { type: "integer" }, name: { type: "string" } },
            required: ["id", "name"],
          },
          example: { id: 7, name: "Ann" },
        },
      },
    });
    expect(doc.paths["/users"].post.responses["201"]).toEqual({
      description: "Created",
      headers: { location: { schema: { type: "string" }, example: "/users/1" } },
    });
  });

  test("an empty list loads with no operations", async () => {
    const imported = await importSchemaContent(generateOpenApi([], "Blank"), "Custom endpoints", {
      allowEmpty: true,
    });
    expect(imported.operations).toEqual([]);
  });

  test("Prism loads the document with the same endpoints and codes", async () => {
    const imported = await importSchemaContent(
      generateOpenApi([users, create], "Users"),
      "Custom endpoints",
    );
    expect(imported.operations.map((op) => [op.method, op.path, op.codes])).toEqual([
      ["post", "/users", ["201"]],
      ["get", "/users/{id}", ["200", "404"]],
    ]);
  });
});

describe("normalizeEndpoint", () => {
  test("lowercases header names and drops a blank summary", () => {
    expect(
      normalizeEndpoint(
        endpoint({
          summary: "  ",
          responses: [{ status: 200, headers: { "X-Total-Count": "3" }, body: "[]" }],
        }),
      ),
    ).toEqual({
      kind: "http",
      method: "get",
      path: "/users/{id}",
      responses: [{ status: 200, headers: { "x-total-count": "3" }, body: "[]" }],
    });
  });

  test.each([
    "users",
    "/users/",
    "/a//b",
    "/files/{name}.json",
    "/a/{1x}",
    "/a/{id}/b/{id}",
    "/a b",
  ])("path %p → ENDPOINT_PATH_INVALID", (path) => {
    expect(codeOf(() => normalizeEndpoint(endpoint({ path })))).toBe("ENDPOINT_PATH_INVALID");
  });

  test("accepts the root path and RFC 3986 segment characters", () => {
    for (const path of ["/", "/v1/users.json", "/a-b/~c/:d/@e", "/items/{item_id}"]) {
      expect(codeOf(() => normalizeEndpoint(endpoint({ path })))).toBe("returned");
    }
  });

  test("status rules", () => {
    const withResponses = (responses: CustomEndpoint["responses"]) => () =>
      normalizeEndpoint(endpoint({ responses }));
    expect(codeOf(withResponses([]))).toBe("RESPONSE_STATUS_INVALID");
    expect(
      codeOf(
        withResponses([
          { status: 200, headers: {}, body: null },
          { status: 200, headers: {}, body: null },
        ]),
      ),
    ).toBe("RESPONSE_STATUS_INVALID");
    for (const status of [99, 600, 200.5]) {
      expect(codeOf(withResponses([{ status, headers: {}, body: null }]))).toBe(
        "RESPONSE_STATUS_INVALID",
      );
    }
    expect(messageOf(withResponses([{ status: 204, headers: {}, body: "{}" }]))).toBe(
      "A 204 response can't have a body.",
    );
    expect(codeOf(withResponses([{ status: 204, headers: {}, body: null }]))).toBe("returned");
  });

  test("body rules: size before JSON", () => {
    const big = `"${"a".repeat(256 * 1024)}"`;
    expect(
      codeOf(() =>
        normalizeEndpoint(endpoint({ responses: [{ status: 200, headers: {}, body: big }] })),
      ),
    ).toBe("RESPONSE_TOO_LARGE");
    expect(
      codeOf(() =>
        normalizeEndpoint(endpoint({ responses: [{ status: 200, headers: {}, body: "{nope" }] })),
      ),
    ).toBe("RESPONSE_INVALID_JSON");
  });

  test("header rules are case-insensitive", () => {
    const withHeaders = (headers: Record<string, string>) => () =>
      normalizeEndpoint(endpoint({ responses: [{ status: 200, headers, body: null }] }));
    for (const name of [
      "Set-Cookie",
      "CONTENT-TYPE",
      "Access-Control-Allow-Origin",
      "X-Mockyard-Override",
      "bad name",
    ]) {
      expect(codeOf(withHeaders({ [name]: "x" }))).toBe("RESPONSE_HEADER_INVALID");
    }
    expect(codeOf(withHeaders({ "X-A": "1", "x-a": "2" }))).toBe("RESPONSE_HEADER_INVALID");
    expect(codeOf(withHeaders({ "x-a": "a\r\nb" }))).toBe("RESPONSE_HEADER_INVALID");
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`x-h${i}`, "1"]));
    expect(codeOf(withHeaders(many))).toBe("RESPONSE_HEADER_INVALID");
  });
});

describe("path templates", () => {
  test("pathKey ignores parameter names only", () => {
    expect(pathKey("/users/{id}")).toBe(pathKey("/users/{userId}"));
    expect(pathKey("/users/{id}")).not.toBe(pathKey("/users/me"));
    expect(pathKey("/")).toBe("/");
  });

  test("pathParams in order", () => {
    expect(pathParams("/users/{id}/posts/{postId}")).toEqual(["id", "postId"]);
    expect(pathParams("/")).toEqual([]);
  });

  test("assertNoDuplicate compares method + template", () => {
    expect(
      codeOf(() => assertNoDuplicate([endpoint()], endpoint({ path: "/users/{userId}" }))),
    ).toBe("ENDPOINT_EXISTS");
    expect(
      messageOf(() => assertNoDuplicate([endpoint()], endpoint({ path: "/users/{userId}" }))),
    ).toBe("GET /users/{id} already exists.");
    expect(codeOf(() => assertNoDuplicate([endpoint()], endpoint({ method: "delete" })))).toBe(
      "returned",
    );
  });
});

describe("defaultServedStatus", () => {
  test("lowest 2xx, else the lowest code", () => {
    expect(defaultServedStatus([404, 201, 200])).toBe(200);
    expect(defaultServedStatus([503, 400])).toBe(400);
    expect(defaultServedStatus([])).toBeNull();
  });
});
