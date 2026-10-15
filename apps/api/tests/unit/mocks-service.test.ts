import "../setup";
import { describe, expect, test } from "bun:test";
import type { CreateMock, OperationSummary, SchemaSource } from "@starter/schemas";
import type { MockVersionRow } from "@/db/schema";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import type { ImportedSchema, SchemaImporter } from "@/modules/mocks/import/importer";
import type {
  MockDetailRecord,
  MocksRepo,
  NewMockInput,
  NewVersionInput,
} from "@/modules/mocks/mocks.repo";
import { createMocksService } from "@/modules/mocks/mocks.service";

const WS = { id: crypto.randomUUID(), slug: "jane", name: "jane's workspace" };
const USER = crypto.randomUUID();
const BASE = "https://app.test/m";

type FakeMock = NewMockInput & {
  id: string;
  status: "running" | "paused";
  liveVersionId: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function op(path: string, hash = "h"): OperationSummary {
  return { method: "get", path, summary: null, codes: ["200"], examples: [], examplesHash: hash };
}

// Content "a,b" → operations GET /a and GET /b; sha = the content itself.
function fakeImported(content: string, sourceLabel: string): ImportedSchema {
  const operations = content.split(",").map((path) => op(`/${path}`));
  return {
    format: "openapi3",
    specVersion: "3.0.3",
    content,
    sha256: `sha:${content}`,
    sizeBytes: content.length,
    operations,
    endpointCount: operations.length,
    exampleCount: 0,
    sourceLabel,
  };
}

function createFakeImporter(urlContent: Map<string, string>): SchemaImporter {
  return {
    async import(source: SchemaSource) {
      if (source.type === "file") return fakeImported(source.content, source.filename);
      const content = urlContent.get(source.url);
      if (content === undefined) throw new Error(`no fake content for ${source.url}`);
      return fakeImported(content, source.url);
    },
  };
}

function createFakeRepo(existingCount = 0) {
  const store = new Map<string, FakeMock>();
  const versions: MockVersionRow[] = [];
  const author = (id: string | null) =>
    id ? { id, name: null, email: `${id}@example.com` } : null;

  function insertVersion(mockId: string, input: NewVersionInput, number: number): MockVersionRow {
    const row: MockVersionRow = {
      ...input,
      id: crypto.randomUUID(),
      mockId,
      number,
      createdAt: new Date(),
    };
    versions.push(row);
    return row;
  }

  function toDetail(mock: FakeMock): MockDetailRecord {
    const live = versions.find((v) => v.id === mock.liveVersionId);
    if (!live) throw new Error("fake: live version missing");
    return {
      id: mock.id,
      workspaceId: mock.workspaceId,
      name: mock.name,
      slug: mock.slug,
      status: mock.status,
      endpointCount: live.endpointCount,
      requests24h: 0,
      updatedAt: mock.updatedAt,
      updatedBy: author(mock.updatedBy),
      responseMode: mock.responseMode,
      validateRequests: mock.validateRequests,
      cors: mock.cors,
      sourceType: mock.sourceType,
      sourceUrl: mock.sourceUrl,
      liveVersionId: live.id,
      createdAt: mock.createdAt,
      createdBy: author(mock.createdBy),
      liveVersion: {
        number: live.number,
        format: live.format,
        specVersion: live.specVersion,
        sourceLabel: live.sourceLabel,
        createdAt: live.createdAt,
        exampleCount: live.exampleCount,
        sizeBytes: live.sizeBytes,
        contentSha256: live.contentSha256,
        operations: live.operations,
      },
      versionCount: versions.filter((v) => v.mockId === mock.id).length,
    };
  }

  const inWorkspace = (workspaceId: string) =>
    [...store.values()].filter((mock) => mock.workspaceId === workspaceId);
  const listCalls: { createdById?: string; q?: string }[] = [];

  const repo: MocksRepo = {
    async list(workspaceId, options) {
      listCalls.push({ createdById: options.createdById, q: options.q });
      const rows = inWorkspace(workspaceId)
        .filter((mock) => !options.createdById || mock.createdBy === options.createdById)
        .map(toDetail);
      return { rows, total: rows.length };
    },
    async countInWorkspace(workspaceId) {
      return existingCount + inWorkspace(workspaceId).length;
    },
    async slugExists(workspaceId, slug) {
      return inWorkspace(workspaceId).some((mock) => mock.slug === slug);
    },
    async findDetail(workspaceId, slug) {
      const mock = inWorkspace(workspaceId).find((m) => m.slug === slug);
      return mock && toDetail(mock);
    },
    async findRoute() {
      throw new Error("fake: runtime-only method");
    },
    async findVersionSource() {
      throw new Error("fake: runtime-only method");
    },
    async findVersionEndpoints() {
      throw new Error("fake: custom-mock method");
    },
    async findVersionByNumber(mockId, number) {
      return versions.find((v) => v.mockId === mockId && v.number === number);
    },
    async listVersions(mockId) {
      return versions
        .filter((v) => v.mockId === mockId)
        .sort((a, b) => b.number - a.number)
        .map((v) => ({
          id: v.id,
          number: v.number,
          action: v.action,
          sourceLabel: v.sourceLabel,
          restoredFrom: v.restoredFrom,
          diff: v.diff,
          endpointCount: v.endpointCount,
          createdAt: v.createdAt,
          createdBy: author(v.createdBy),
        }));
    },
    async createWithVersion(input, version) {
      const id = crypto.randomUUID();
      const mock: FakeMock = {
        ...input,
        id,
        status: "running",
        liveVersionId: "",
        updatedBy: input.createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(id, mock);
      mock.liveVersionId = insertVersion(id, version, 1).id;
      return id;
    },
    async appendVersion(mockId, version, patch) {
      const mock = store.get(mockId);
      if (!mock) throw new Error("fake: no mock");
      const number =
        Math.max(...versions.filter((v) => v.mockId === mockId).map((v) => v.number)) + 1;
      const row = insertVersion(mockId, version, number);
      Object.assign(mock, patch, { liveVersionId: row.id, updatedAt: new Date() });
      return number;
    },
    async update(mockId, patch) {
      const mock = store.get(mockId);
      if (!mock) throw new Error("fake: no mock");
      Object.assign(mock, patch, { updatedAt: new Date() });
    },
    async delete(mockId) {
      store.delete(mockId);
    },
  };
  return { repo, store, versions, listCalls };
}

function setup(options: { existingCount?: number; urls?: Record<string, string> } = {}) {
  const fakes = createFakeRepo(options.existingCount ?? 0);
  const urlContent = new Map(Object.entries(options.urls ?? {}));
  const invalidated: string[] = [];
  const unexpected = async () => {
    throw new Error("unexpected overrides call");
  };
  const service = createMocksService({
    mocksRepo: fakes.repo,
    overridesRepo: {
      list: unexpected,
      upsert: unexpected,
      findBody: unexpected,
      delete: unexpected,
    },
    schemaImporter: createFakeImporter(urlContent),
    invalidate: async (...keys: string[]) => {
      invalidated.push(...keys);
    },
    publicBaseUrl: BASE,
    versionOperations: async () => {
      throw new Error("unexpected operations load");
    },
  });
  return { ...fakes, service, invalidated, urlContent };
}

function createInput(overrides: Partial<CreateMock> = {}): CreateMock {
  return {
    name: "Pets",
    slug: "pets",
    responseMode: "static",
    validateRequests: true,
    cors: true,
    source: { type: "file", filename: "pets.yaml", content: "a,b" },
    ...overrides,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof AppError ? error.code : `non-app-error: ${String(error)}`;
  }
}

const QUERY: ListQuery = { page: 1, pageSize: 20, sort: [], filters: [] };

describe("create", () => {
  test("creates v1, returns the detail with the public URL, and invalidates the route", async () => {
    const { service, invalidated } = setup();
    const detail = await service.create(WS, USER, createInput());
    expect(detail.url).toBe("https://app.test/m/jane/pets");
    expect(detail.liveVersion).toMatchObject({ number: 1, sourceLabel: "pets.yaml" });
    expect(detail.versionCount).toBe(1);
    expect(detail.endpointCount).toBe(2);
    expect(detail.createdBy).toEqual({ id: USER, name: null, email: `${USER}@example.com` });
    expect(invalidated).toEqual(["cache:mocks:route:jane/pets"]);
  });

  test("validates the slug", async () => {
    const { service } = setup();
    expect(await codeOf(service.create(WS, USER, createInput({ slug: "Bad Slug" })))).toBe(
      "SLUG_INVALID",
    );
    expect(await codeOf(service.create(WS, USER, createInput({ slug: "new" })))).toBe("SLUG_TAKEN");
  });

  test("rejects a taken slug with the spec message", async () => {
    const { service } = setup();
    await service.create(WS, USER, createInput());
    const error = await service.create(WS, USER, createInput()).catch((e: unknown) => e);
    expect((error as AppError).code).toBe("SLUG_TAKEN");
    expect((error as AppError).status).toBe(409);
    expect((error as AppError).message).toBe("pets is already taken in jane's workspace.");
  });

  test("enforces 50 mocks per workspace", async () => {
    const { service } = setup({ existingCount: 50 });
    expect(await codeOf(service.create(WS, USER, createInput()))).toBe("MOCK_LIMIT_REACHED");
  });

  test("stores the URL for url sources", async () => {
    const { service } = setup({ urls: { "https://x.test/a": "a" } });
    const detail = await service.create(
      WS,
      USER,
      createInput({ source: { type: "url", url: "https://x.test/a" } }),
    );
    expect(detail).toMatchObject({ sourceType: "url", sourceUrl: "https://x.test/a" });
  });
});

describe("checkSlug", () => {
  test("reports invalid, reserved, taken, and available", async () => {
    const { service } = setup();
    await service.create(WS, USER, createInput());
    expect(await service.checkSlug(WS, "Nope!")).toEqual({
      slug: "Nope!",
      available: false,
      reason: "invalid",
    });
    expect(await service.checkSlug(WS, "settings")).toEqual({
      slug: "settings",
      available: false,
      reason: "reserved",
    });
    expect(await service.checkSlug(WS, "pets")).toEqual({
      slug: "pets",
      available: false,
      reason: "taken",
    });
    expect(await service.checkSlug(WS, "orders")).toEqual({
      slug: "orders",
      available: true,
      reason: null,
    });
  });
});

describe("list", () => {
  test("maps filter[createdBy][eq]=me to the caller and trims q", async () => {
    const { service, listCalls } = setup();
    await service.create(WS, USER, createInput());
    const result = await service.list(
      WS,
      USER,
      { ...QUERY, filters: [{ field: "createdBy", op: "eq", value: "me" }] },
      "  pe  ",
    );
    expect(result.total).toBe(1);
    expect(result.rows[0]?.url).toBe("https://app.test/m/jane/pets");
    expect(listCalls.at(-1)).toEqual({ createdById: USER, q: "pe" });
  });

  test("rejects any other createdBy filter", async () => {
    const { service } = setup();
    const bad = service.list(
      WS,
      USER,
      { ...QUERY, filters: [{ field: "createdBy", op: "eq", value: USER }] },
      undefined,
    );
    expect(await bad.catch((e: unknown) => e)).toBeInstanceOf(ValidationError);
  });
});

describe("update and delete", () => {
  test("slug change invalidates old and new keys; old slug 404s", async () => {
    const { service, invalidated } = setup();
    await service.create(WS, USER, createInput());
    invalidated.length = 0;
    const detail = await service.update(WS, USER, "pets", { slug: "animals", status: "paused" });
    expect(detail).toMatchObject({ slug: "animals", status: "paused" });
    expect(invalidated).toEqual(["cache:mocks:route:jane/pets", "cache:mocks:route:jane/animals"]);
    expect(await service.get(WS, "pets").catch((e: unknown) => e)).toBeInstanceOf(NotFoundError);
  });

  test("slug change to a taken slug is SLUG_TAKEN", async () => {
    const { service } = setup();
    await service.create(WS, USER, createInput());
    await service.create(WS, USER, createInput({ slug: "orders" }));
    expect(await codeOf(service.update(WS, USER, "pets", { slug: "orders" }))).toBe("SLUG_TAKEN");
  });

  test("delete removes the mock and invalidates its route", async () => {
    const { service, invalidated } = setup();
    await service.create(WS, USER, createInput());
    invalidated.length = 0;
    await service.remove(WS, "pets");
    expect(invalidated).toEqual(["cache:mocks:route:jane/pets"]);
    expect(await service.get(WS, "pets").catch((e: unknown) => e)).toBeInstanceOf(NotFoundError);
  });
});

describe("versions", () => {
  test("replace with identical content is a no-op; changed content creates v2 with a diff", async () => {
    const { service, versions } = setup();
    await service.create(WS, USER, createInput());
    const same = await service.replace(WS, USER, "pets", {
      type: "file",
      filename: "again.yaml",
      content: "a,b",
    });
    expect(same.liveVersion.number).toBe(1);
    expect(versions).toHaveLength(1);

    const changed = await service.replace(WS, USER, "pets", {
      type: "file",
      filename: "v2.yaml",
      content: "a,c,d",
    });
    expect(changed.liveVersion).toMatchObject({ number: 2, sourceLabel: "v2.yaml" });
    const list = await service.listVersions(WS, "pets");
    expect(list.map((v) => [v.number, v.action, v.live])).toEqual([
      [2, "replace", true],
      [1, "create", false],
    ]);
    expect(list[0]?.diff).toEqual({ endpointsAdded: 2, endpointsRemoved: 1, examplesChanged: 0 });
    expect(list[1]?.diff).toBeNull();
  });

  test("replace switches the source type", async () => {
    const { service } = setup({ urls: { "https://x.test/s": "z" } });
    await service.create(WS, USER, createInput());
    const detail = await service.replace(WS, USER, "pets", {
      type: "url",
      url: "https://x.test/s",
    });
    expect(detail).toMatchObject({ sourceType: "url", sourceUrl: "https://x.test/s" });
  });

  test("resync: file mocks are rejected; unchanged is a no-op; changed creates a version", async () => {
    const { service, urlContent } = setup({ urls: { "https://x.test/a": "a" } });
    await service.create(WS, USER, createInput());
    expect(await codeOf(service.resync(WS, USER, "pets"))).toBe("NOT_URL_SOURCE");

    await service.create(
      WS,
      USER,
      createInput({ slug: "remote", source: { type: "url", url: "https://x.test/a" } }),
    );
    const unchanged = await service.resync(WS, USER, "remote");
    expect(unchanged.changed).toBe(false);
    expect(unchanged.mock.liveVersion.number).toBe(1);

    urlContent.set("https://x.test/a", "a,b");
    const changed = await service.resync(WS, USER, "remote");
    expect(changed.changed).toBe(true);
    expect(changed.mock.liveVersion.number).toBe(2);
    expect((await service.listVersions(WS, "remote"))[0]?.action).toBe("resync");
  });

  test("restore copies an old version as a new live one", async () => {
    const { service } = setup();
    await service.create(WS, USER, createInput());
    await service.replace(WS, USER, "pets", { type: "file", filename: "v2.yaml", content: "x" });
    const restored = await service.restore(WS, USER, "pets", 1);
    expect(restored.liveVersion).toMatchObject({ number: 3, sourceLabel: "pets.yaml" });
    expect(restored.endpointCount).toBe(2);
    const [latest] = await service.listVersions(WS, "pets");
    expect(latest).toMatchObject({ number: 3, action: "restore", restoredFrom: 1 });

    // Restoring the live content again is a no-op.
    expect((await service.restore(WS, USER, "pets", 3)).liveVersion.number).toBe(3);
    expect((await service.restore(WS, USER, "pets", 1)).liveVersion.number).toBe(3);
    expect(await service.restore(WS, USER, "pets", 99).catch((e: unknown) => e)).toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("inspect", () => {
  test("returns the import summary without persisting", async () => {
    const { service, versions } = setup();
    const inspection = await service.inspect({
      type: "file",
      filename: "x.yaml",
      content: "a,b,c",
    });
    expect(inspection).toEqual({
      format: "openapi3",
      specVersion: "3.0.3",
      endpointCount: 3,
      exampleCount: 0,
      sizeBytes: 5,
      sourceLabel: "x.yaml",
    });
    expect(versions).toHaveLength(0);
  });
});
