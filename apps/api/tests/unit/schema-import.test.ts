import "../setup";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { OperationSummary } from "@starter/schemas";
import { AppError } from "@/lib/errors";
import { describeOperations } from "@/modules/mocks/import/describe";
import { diffOperations } from "@/modules/mocks/import/diff";
import { createSchemaImporter, importSchemaContent } from "@/modules/mocks/import/importer";
import { loadOperations } from "@/modules/mocks/import/operations";
import { detectFormat, parseSchemaContent } from "@/modules/mocks/import/parse";
import { assertNoExternalRefs } from "@/modules/mocks/import/refs";
import { summarizeOperations } from "@/modules/mocks/import/summarize";
import { MAX_SCHEMA_BYTES } from "@/modules/mocks/mocks.constants";

const FIXTURES = join(import.meta.dir, "../fixtures/schemas");

function fixture(name: string): Promise<string> {
  return Bun.file(join(FIXTURES, name)).text();
}

// Resolves to the AppError code (or a marker) so assertions read as one line.
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof AppError ? error.code : `non-app-error: ${String(error)}`;
  }
}

function codeOfSync(fn: () => unknown): string {
  try {
    fn();
    return "returned";
  } catch (error) {
    return error instanceof AppError ? error.code : `non-app-error: ${String(error)}`;
  }
}

describe("importSchemaContent — accepted formats", () => {
  test("OpenAPI 3.0 YAML", async () => {
    const content = await fixture("petstore-3.0.yaml");
    const imported = await importSchemaContent(content, "petstore-3.0.yaml");
    expect(imported.format).toBe("openapi3");
    expect(imported.specVersion).toBe("3.0.3");
    expect(imported.endpointCount).toBe(2);
    expect(imported.exampleCount).toBe(4);
    expect(imported.sizeBytes).toBe(Buffer.byteLength(content));
    expect(imported.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(imported.sourceLabel).toBe("petstore-3.0.yaml");
    expect(imported.content).toBe(content);
    expect(imported.operations.map((op) => `${op.method} ${op.path}`)).toEqual([
      "get /pets",
      "get /pets/{id}",
    ]);
    expect(imported.operations[1]).toMatchObject({
      summary: "Get a pet",
      codes: ["200", "404"],
      examples: ["default", "fido", "rex"],
    });
  });

  test("OpenAPI 3.1 JSON with internal $ref", async () => {
    const imported = await importSchemaContent(await fixture("orders-3.1.json"), "orders.json");
    expect(imported.format).toBe("openapi3");
    expect(imported.specVersion).toBe("3.1.0");
    expect(imported.endpointCount).toBe(1);
    expect(imported.exampleCount).toBe(1);
    expect(imported.operations[0]).toMatchObject({
      method: "post",
      path: "/orders",
      codes: ["201"],
    });
  });

  test("Postman collection v2.1", async () => {
    const imported = await importSchemaContent(await fixture("collection-2.1.json"), "c.json");
    expect(imported.format).toBe("postman2");
    expect(imported.specVersion).toBe("2.1.0");
    expect(imported.endpointCount).toBe(1);
    expect(imported.operations[0]?.method).toBe("get");
  });
});

describe("importSchemaContent — rejections", () => {
  test("Swagger 2.0 is unsupported", async () => {
    expect(await codeOf(importSchemaContent(await fixture("swagger-2.0.json"), "s.json"))).toBe(
      "SCHEMA_UNSUPPORTED",
    );
  });

  test("unknown documents are unsupported", async () => {
    expect(await codeOf(importSchemaContent('{"hello":"world"}', "x.json"))).toBe(
      "SCHEMA_UNSUPPORTED",
    );
    expect(await codeOf(importSchemaContent('{"openapi":"2.0"}', "x.json"))).toBe(
      "SCHEMA_UNSUPPORTED",
    );
  });

  test("external $ref is rejected before Prism ever sees it", async () => {
    expect(await codeOf(importSchemaContent(await fixture("external-ref.yaml"), "e.yaml"))).toBe(
      "SCHEMA_EXTERNAL_REF",
    );
  });

  test("no paths", async () => {
    expect(await codeOf(importSchemaContent(await fixture("empty-paths.yaml"), "e.yaml"))).toBe(
      "SCHEMA_NO_PATHS",
    );
  });

  test("more than 1000 operations", async () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 1001; i++) {
      paths[`/r${i}`] = { get: { responses: { "200": { description: "OK" } } } };
    }
    const content = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Big", version: "1" },
      paths,
    });
    expect(await codeOf(importSchemaContent(content, "big.json"))).toBe(
      "SCHEMA_TOO_MANY_OPERATIONS",
    );
  });

  test("size is checked in bytes before parsing, with the label in the message", async () => {
    const content = `{"x":"${"é".repeat(MAX_SCHEMA_BYTES / 2)}"}`;
    const error = await importSchemaContent(content, "huge.json").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("SCHEMA_TOO_LARGE");
    expect((error as AppError).message).toBe("huge.json is larger than 5 MB.");
  });

  test("invalid JSON / YAML / non-object documents", async () => {
    const error = await importSchemaContent("{ not json", "bad.json").catch((e: unknown) => e);
    expect((error as AppError).code).toBe("SCHEMA_PARSE_FAILED");
    expect((error as AppError).message).toBe("bad.json isn't valid JSON or YAML.");
    expect(await codeOf(importSchemaContent("openapi: [1, 2", "bad.yaml"))).toBe(
      "SCHEMA_PARSE_FAILED",
    );
    expect(await codeOf(importSchemaContent("just a string", "s.yaml"))).toBe(
      "SCHEMA_PARSE_FAILED",
    );
    expect(await codeOf(importSchemaContent("- 1\n- 2", "list.yaml"))).toBe("SCHEMA_PARSE_FAILED");
  });
});

describe("parse helpers", () => {
  test("leading whitespace before { still takes the JSON path", () => {
    expect(parseSchemaContent('  \n {"a":1}', "x")).toEqual({ a: 1 });
  });

  test("detectFormat reads the Postman version from the schema URL", () => {
    const v20 = detectFormat({
      info: { schema: "https://schema.getpostman.com/json/collection/v2.0.0/collection.json" },
      item: [],
    });
    expect(v20).toEqual({ format: "postman2", specVersion: "2.0.0" });
    expect(
      codeOfSync(() => detectFormat({ info: { schema: "…/collection/v2.1.0/" }, item: {} })),
    ).toBe("SCHEMA_UNSUPPORTED");
  });

  test("assertNoExternalRefs walks arrays and nested objects", () => {
    expect(codeOfSync(() => assertNoExternalRefs({ a: [{ b: { $ref: "#/x" } }] }))).toBe(
      "returned",
    );
    for (const ref of ["./other.yaml#/x", "https://evil.test/x.json", "file:///etc/passwd", ""]) {
      expect(codeOfSync(() => assertNoExternalRefs({ a: [{ b: { $ref: ref } }] }))).toBe(
        "SCHEMA_EXTERNAL_REF",
      );
    }
  });

  test("assertNoExternalRefs terminates on shared YAML aliases", () => {
    const shared = { $ref: "#/components/schemas/A" };
    expect(codeOfSync(() => assertNoExternalRefs({ x: shared, y: shared, z: [shared] }))).toBe(
      "returned",
    );
  });
});

describe("summarizeOperations", () => {
  const op = (examples: { key: string; value: unknown; id?: string }[]) => ({
    method: "get",
    path: "/a",
    responses: [{ code: "200", contents: [{ mediaType: "application/json", examples }] }],
  });

  test("examplesHash ignores Prism's random example ids and key order inside values", () => {
    const a = summarizeOperations([op([{ key: "x", value: { a: 1, b: 2 }, id: "r1" }])]);
    const b = summarizeOperations([op([{ key: "x", value: { b: 2, a: 1 }, id: "r2" }])]);
    expect(a.operations[0]?.examplesHash).toBe(b.operations[0]?.examplesHash ?? "");
  });

  test("examplesHash changes when an example value changes", () => {
    const a = summarizeOperations([op([{ key: "x", value: 1 }])]);
    const b = summarizeOperations([op([{ key: "x", value: 2 }])]);
    expect(a.operations[0]?.examplesHash).not.toBe(b.operations[0]?.examplesHash ?? "");
  });
});

describe("describeOperations", () => {
  const spec = `
openapi: 3.0.3
info: { title: t, version: "1" }
paths:
  /pets/{petId}:
    parameters:
      - { name: petId, in: path, required: true, schema: { type: integer }, example: 7 }
    get:
      parameters:
        - { name: limit, in: query, description: page size, schema: { type: integer, default: 10 } }
        - { name: X-Trace, in: header, schema: { type: string } }
      responses: { "200": { description: ok } }
    put:
      requestBody:
        required: true
        content:
          text/plain:
            schema: { type: string }
          application/merge-patch+json:
            schema: { $ref: "#/components/schemas/Pet" }
            example: { name: rex }
      responses: { "200": { description: ok } }
components:
  schemas:
    Pet:
      type: object
      required: [name]
      properties:
        name: { type: string }
        parent: { $ref: "#/components/schemas/Pet" }
`;
  const describeSpec = async () =>
    describeOperations(await loadOperations(parseSchemaContent(spec, "p"), "p"));

  test("describes path-level, query and header parameters without Prism's stamps", async () => {
    const [get] = await describeSpec();
    expect(get?.method).toBe("get");
    expect(get?.body).toBeNull();
    expect(get?.parameters).toEqual({
      // Prism also copies a parameter's single `example` into its schema.
      path: [
        {
          name: "petId",
          required: true,
          description: null,
          schema: { type: "integer", examples: [7] },
          examples: [7],
        },
      ],
      query: [
        {
          name: "limit",
          required: false,
          description: "page size",
          schema: { type: "integer", default: 10 },
          examples: [],
        },
      ],
      header: [
        {
          name: "X-Trace",
          required: false,
          description: null,
          schema: { type: "string" },
          examples: [],
        },
      ],
    });
  });

  test("prefers a JSON body media type and keeps recursive schemas serializable", async () => {
    const put = (await describeSpec()).find((op) => op.method === "put");
    expect(put?.body?.mediaType).toBe("application/merge-patch+json");
    expect(put?.body?.required).toBe(true);
    expect(put?.body?.examples).toEqual([{ name: "rex" }]);
    const roundTripped = JSON.parse(JSON.stringify(put?.body?.schema));
    expect(roundTripped).toMatchObject({ type: "object", required: ["name"] });
  });
});

describe("diffOperations", () => {
  const summary = (method: OperationSummary["method"], path: string, hash: string) =>
    ({
      method,
      path,
      summary: null,
      codes: ["200"],
      examples: [],
      examplesHash: hash,
    }) satisfies OperationSummary;

  test("counts added, removed, and example-changed endpoints keyed by METHOD path", () => {
    const previous = [
      summary("get", "/a", "1"),
      summary("get", "/b", "1"),
      summary("post", "/a", "1"),
    ];
    const next = [summary("get", "/a", "2"), summary("post", "/a", "1"), summary("get", "/c", "1")];
    expect(diffOperations(previous, next)).toEqual({
      endpointsAdded: 1,
      endpointsRemoved: 1,
      examplesChanged: 1,
    });
  });
});

describe("createSchemaImporter", () => {
  test("file sources import their content with the filename as label", async () => {
    const importer = createSchemaImporter({
      fetchUrl: async () => {
        throw new Error("must not fetch");
      },
    });
    const imported = await importer.import({
      type: "file",
      filename: "pets.yaml",
      content: await fixture("petstore-3.0.yaml"),
    });
    expect(imported.sourceLabel).toBe("pets.yaml");
  });

  test("url sources are fetched and labelled with the URL", async () => {
    const fetched: string[] = [];
    const content = await fixture("orders-3.1.json");
    const importer = createSchemaImporter({
      fetchUrl: async (url) => {
        fetched.push(url);
        return content;
      },
    });
    const imported = await importer.import({ type: "url", url: "https://x.test/o.json" });
    expect(fetched).toEqual(["https://x.test/o.json"]);
    expect(imported.sourceLabel).toBe("https://x.test/o.json");
  });
});

describe("importSchemaContent — empty documents (custom mocks)", () => {
  const empty = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Blank", version: "1.0.0" },
    paths: {},
  });

  test("rejected by default", async () => {
    expect(await codeOf(importSchemaContent(empty, "e.json"))).toBe("SCHEMA_NO_PATHS");
  });

  test("accepted with allowEmpty", async () => {
    const imported = await importSchemaContent(empty, "Custom endpoints", { allowEmpty: true });
    expect(imported.operations).toEqual([]);
    expect(imported.endpointCount).toBe(0);
  });

  test("loadOperations returns no operations (the runtime loader relies on it)", async () => {
    expect(await loadOperations(JSON.parse(empty), "Stored schema")).toEqual([]);
  });
});

describe("loadOperations — callbacks (SSRF)", () => {
  test("strips OpenAPI callbacks so Prism never calls out to spec-chosen URLs", async () => {
    const ok = { "200": { description: "ok" } };
    const spec = {
      openapi: "3.0.3",
      info: { title: "Callbacks", version: "1" },
      paths: {
        "/hook": {
          get: {
            responses: ok,
            callbacks: {
              ping: { "http://169.254.169.254/{$request.query.u}": { post: { responses: ok } } },
            },
          },
        },
      },
    };
    const [op] = await loadOperations(spec, "p");
    expect(op?.path).toBe("/hook");
    expect(op).not.toHaveProperty("callbacks");
  });
});
