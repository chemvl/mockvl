import "../setup";
import { describe, expect, test } from "bun:test";
import {
  CreateMockSchema,
  type MockDetail,
  MockDetailSchema,
  mockListFields,
  SchemaSourceSchema,
  UpdateMockSchema,
  type UsageReport,
  UsageReportSchema,
} from "@starter/schemas";
import { ValidationError } from "@/lib/errors";
import { parseListQuery } from "@/lib/pagination";

describe("SchemaSource", () => {
  test("discriminates on type", () => {
    expect(
      SchemaSourceSchema.parse({ type: "file", filename: "pets.yaml", content: "openapi: 3.0.0" }),
    ).toEqual({ type: "file", filename: "pets.yaml", content: "openapi: 3.0.0" });
    expect(SchemaSourceSchema.parse({ type: "url", url: "https://x.test/a.json" })).toEqual({
      type: "url",
      url: "https://x.test/a.json",
    });
    expect(SchemaSourceSchema.safeParse({ type: "ftp", url: "x" }).success).toBe(false);
    expect(SchemaSourceSchema.safeParse({ type: "file", filename: "", content: "x" }).success).toBe(
      false,
    );
    expect(
      SchemaSourceSchema.safeParse({ type: "file", filename: "x".repeat(201), content: "x" })
        .success,
    ).toBe(false);
  });
});

describe("CreateMock / UpdateMock", () => {
  test("CreateMock applies behavior defaults", () => {
    const parsed = CreateMockSchema.parse({
      name: "Pets",
      slug: "pets",
      source: { type: "url", url: "https://x.test/a.json" },
    });
    expect(parsed.responseMode).toBe("static");
    expect(parsed.validateRequests).toBe(true);
    expect(parsed.cors).toBe(true);
  });

  test("CreateMock rejects names over 80 characters", () => {
    const result = CreateMockSchema.safeParse({
      name: "x".repeat(81),
      slug: "pets",
      source: { type: "url", url: "https://x.test/a.json" },
    });
    expect(result.success).toBe(false);
  });

  test("UpdateMock is fully optional", () => {
    expect(UpdateMockSchema.parse({})).toEqual({});
    expect(UpdateMockSchema.parse({ status: "paused" })).toEqual({ status: "paused" });
    expect(UpdateMockSchema.safeParse({ status: "stopped" }).success).toBe(false);
  });
});

describe("response schemas", () => {
  test("MockDetail accepts the documented shape", () => {
    const detail = {
      id: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a",
      name: "Pets",
      slug: "pets",
      url: "http://localhost:8080/m/ws/pets",
      status: "running",
      endpointCount: 1,
      requests24h: 0,
      updatedAt: "2026-10-07T00:00:00.000Z",
      updatedBy: null,
      responseMode: "static",
      validateRequests: true,
      cors: true,
      sourceType: "file",
      sourceUrl: null,
      liveVersion: {
        number: 1,
        format: "openapi3",
        specVersion: "3.0.3",
        sourceLabel: "pets.yaml",
        createdAt: "2026-10-07T00:00:00.000Z",
        exampleCount: 2,
        sizeBytes: 100,
      },
      versionCount: 1,
      operations: [
        {
          method: "get",
          path: "/pets/{id}",
          summary: null,
          codes: ["200"],
          examples: ["default"],
          examplesHash: "abc",
        },
      ],
      createdAt: "2026-10-07T00:00:00.000Z",
      createdBy: { id: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a", name: null, email: "a@b.test" },
    } satisfies MockDetail;
    expect(MockDetailSchema.parse(detail)).toEqual(detail);
  });

  test("UsageReport accepts the documented shape", () => {
    const report = {
      range: "7d",
      totals: { requests: 1, clientErrors: 0, serverErrors: 0 },
      daily: [{ date: "2026-10-07", requests: 1 }],
      mocks: [{ slug: "pets", name: "Pets", requests: 1, clientErrors: 0, serverErrors: 0 }],
    } satisfies UsageReport;
    expect(UsageReportSchema.parse(report)).toEqual(report);
  });
});

describe("mockListFields drive the list contract", () => {
  test("allows the spec's sorts and filters", () => {
    const query = parseListQuery(
      {
        sort: "updatedAt:desc,name:asc",
        "filter[status][eq]": "paused",
        "filter[createdBy][eq]": "me",
      },
      mockListFields,
    );
    expect(query.sort).toEqual([
      { field: "updatedAt", dir: "desc" },
      { field: "name", dir: "asc" },
    ]);
    expect(query.filters).toEqual([
      { field: "status", op: "eq", value: "paused" },
      { field: "createdBy", op: "eq", value: "me" },
    ]);
  });

  test("rejects anything else", () => {
    expect(() => parseListQuery({ sort: "slug:asc" }, mockListFields)).toThrow(ValidationError);
    expect(() => parseListQuery({ "filter[status][eq]": "gone" }, mockListFields)).toThrow(
      ValidationError,
    );
  });
});
