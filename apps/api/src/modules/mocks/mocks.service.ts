import {
  type CreateMock,
  type CustomEndpoint,
  type CustomEndpointList,
  type CustomEndpointResult,
  isValidSlug,
  type MockDetail,
  type MockListItem,
  type MockOverride,
  type MockSchemaFile,
  type MockVersion,
  NO_BODY_STATUS_CODES,
  type OperationMethod,
  type OperationRequest,
  RESERVED_MOCK_SLUGS,
  type ResyncResult,
  type SaveCustomEndpoint,
  type SaveMockOverride,
  type SchemaInspection,
  type SchemaSource,
  type SlugAvailability,
  type UpdateMock,
  type Workspace,
} from "@starter/schemas";
import type { IHttpOperation } from "@stoplight/types";
import type { InvalidateFn } from "@/lib/cache";
import { isUniqueViolation } from "@/lib/db-errors";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ListQuery } from "@/lib/pagination";
import { generateOpenApi } from "./custom/generate-openapi";
import { assertNoDuplicate, normalizeEndpoint } from "./custom/validate-endpoint";
import { describeOperations } from "./import/describe";
import { diffOperations } from "./import/diff";
import { type ImportedSchema, importSchemaContent, type SchemaImporter } from "./import/importer";
import { mockOverrideCacheKey, mockRouteCacheKey } from "./mocks.cache";
import {
  CUSTOM_SOURCE_LABEL,
  MAX_MOCKS_PER_WORKSPACE,
  MAX_OVERRIDE_BODY_BYTES,
} from "./mocks.constants";
import { mockErrors } from "./mocks.errors";
import type { MockDetailRecord, MocksRepo, NewVersionInput } from "./mocks.repo";
import {
  mockUrl,
  toCustomEndpointSummary,
  toMockDetail,
  toMockListItem,
  toMockOverride,
  toMockVersion,
} from "./mocks.serialize";
import type { OverrideKey, OverridesRepo } from "./overrides.repo";

export type WorkspaceRef = Pick<Workspace, "id" | "slug" | "name">;
export type EndpointKey = { method: OperationMethod; path: string };

export interface MocksServiceDeps {
  mocksRepo: MocksRepo;
  // Saved response bodies; owned by the mock, not a version (overrides spec
  // Decision 3), so version mutations below never touch them.
  overridesRepo: OverridesRepo;
  schemaImporter: SchemaImporter;
  // Drops the mock runtime's cached route for each affected (ws, slug).
  // Production passes lib/cache's invalidate (Redis + L1).
  invalidate: InvalidateFn;
  // env.MOCK_PUBLIC_BASE_URL — no trailing slash.
  publicBaseUrl: string;
  // Prism operations of a (immutable) mock version, parsed from its stored
  // content. Production passes an in-process LRU over the version loader.
  versionOperations: (versionId: string) => Promise<IHttpOperation[]>;
}

type SlugProblem = "invalid" | "reserved";

function slugProblem(slug: string): SlugProblem | null {
  if (!isValidSlug(slug)) return "invalid";
  if (RESERVED_MOCK_SLUGS.includes(slug)) return "reserved";
  return null;
}

function versionInput(
  imported: Pick<
    ImportedSchema,
    | "sourceLabel"
    | "format"
    | "specVersion"
    | "content"
    | "sizeBytes"
    | "operations"
    | "endpointCount"
    | "exampleCount"
  > & { sha256: string },
  rest: Pick<NewVersionInput, "action" | "restoredFrom" | "diff" | "createdBy" | "customEndpoints">,
): NewVersionInput {
  return {
    ...rest,
    sourceLabel: imported.sourceLabel,
    format: imported.format,
    specVersion: imported.specVersion,
    content: imported.content,
    contentSha256: imported.sha256,
    sizeBytes: imported.sizeBytes,
    endpointCount: imported.endpointCount,
    exampleCount: imported.exampleCount,
    operations: imported.operations,
  };
}

// A custom mock's version content: the OpenAPI document generated from its
// endpoint list, through the same import pipeline as uploaded schemas.
function importCustomEndpoints(
  endpoints: CustomEndpoint[],
  title: string,
): Promise<ImportedSchema> {
  return importSchemaContent(generateOpenApi(endpoints, title), CUSTOM_SOURCE_LABEL, {
    allowEmpty: true,
  });
}

// Business rules for mock management. Returns wire DTOs (dates as ISO
// strings, public URL filled in) so every route is a one-line envelope.
export function createMocksService(deps: MocksServiceDeps) {
  const { mocksRepo, overridesRepo, schemaImporter, invalidate, publicBaseUrl, versionOperations } =
    deps;

  const urlFor = (ws: WorkspaceRef, slug: string) => mockUrl(publicBaseUrl, ws.slug, slug);
  const detailOf = (ws: WorkspaceRef, record: MockDetailRecord) =>
    toMockDetail(record, urlFor(ws, record.slug));

  async function loadRecord(ws: WorkspaceRef, slug: string): Promise<MockDetailRecord> {
    const record = await mocksRepo.findDetail(ws.id, slug);
    if (!record) throw new NotFoundError("Mock not found");
    return record;
  }

  async function loadDetail(ws: WorkspaceRef, slug: string): Promise<MockDetail> {
    return detailOf(ws, await loadRecord(ws, slug));
  }

  // Reserved names collide with UI routes, so they read as "taken".
  async function assertSlugUsable(ws: WorkspaceRef, slug: string): Promise<void> {
    const problem = slugProblem(slug);
    if (problem === "invalid") throw mockErrors.slugInvalid();
    if (problem === "reserved" || (await mocksRepo.slugExists(ws.id, slug))) {
      throw mockErrors.slugTaken(slug, ws.name);
    }
  }

  async function dropRoutes(ws: WorkspaceRef, ...slugs: string[]): Promise<void> {
    await invalidate(...[...new Set(slugs)].map((slug) => mockRouteCacheKey(ws.slug, slug)));
  }

  async function loadCustom(
    ws: WorkspaceRef,
    slug: string,
  ): Promise<{ current: MockDetailRecord; endpoints: CustomEndpoint[] }> {
    const current = await loadRecord(ws, slug);
    if (current.sourceType !== "custom") throw mockErrors.mockNotCustom();
    return {
      current,
      endpoints: (await mocksRepo.findVersionEndpoints(current.liveVersionId)) ?? [],
    };
  }

  // Fail fast; appendVersion re-checks under the row lock.
  function assertBaseVersion(current: MockDetailRecord, baseVersion: number): void {
    if (current.liveVersion.number !== baseVersion) throw mockErrors.versionConflict();
  }

  function indexOf(endpoints: CustomEndpoint[], key: EndpointKey): number {
    const index = endpoints.findIndex(
      (item) => item.method === key.method && item.path === key.path,
    );
    if (index < 0) throw mockErrors.endpointNotFound(key.method, key.path);
    return index;
  }

  // Every endpoint change is one live version (custom mocks spec Decision 7).
  async function commitEndpoints(
    ws: WorkspaceRef,
    userId: string,
    current: MockDetailRecord,
    endpoints: CustomEndpoint[],
    baseVersion: number,
  ): Promise<number> {
    const imported = await importCustomEndpoints(endpoints, current.name);
    const number = await mocksRepo.appendVersion(
      current.id,
      versionInput(imported, {
        action: "edit",
        restoredFrom: null,
        diff: diffOperations(current.liveVersion.operations, imported.operations),
        createdBy: userId,
        customEndpoints: endpoints,
      }),
      { updatedBy: userId },
      baseVersion,
    );
    if (number === null) throw mockErrors.versionConflict();
    // The cached route still points at the previous live version.
    await dropRoutes(ws, current.slug);
    return number;
  }

  return {
    async list(
      ws: WorkspaceRef,
      userId: string,
      query: ListQuery,
      rawQ: string | undefined,
    ): Promise<{ rows: MockListItem[]; total: number }> {
      let createdById: string | undefined;
      const filters = query.filters.filter((filter) => {
        if (filter.field !== "createdBy") return true;
        if (filter.op !== "eq" || filter.value !== "me") {
          throw new ValidationError('filter[createdBy] only supports eq "me"');
        }
        createdById = userId;
        return false;
      });
      const q = rawQ?.trim() || undefined;
      const { rows, total } = await mocksRepo.list(ws.id, {
        query: { ...query, filters },
        ...(q === undefined ? {} : { q }),
        ...(createdById === undefined ? {} : { createdById }),
      });
      return { rows: rows.map((row) => toMockListItem(row, urlFor(ws, row.slug))), total };
    },

    async checkSlug(ws: WorkspaceRef, slug: string): Promise<SlugAvailability> {
      const problem = slugProblem(slug);
      if (problem) return { slug, available: false, reason: problem };
      if (await mocksRepo.slugExists(ws.id, slug))
        return { slug, available: false, reason: "taken" };
      return { slug, available: true, reason: null };
    },

    async inspect(source: SchemaSource): Promise<SchemaInspection> {
      const imported = await schemaImporter.import(source);
      return {
        format: imported.format,
        specVersion: imported.specVersion,
        endpointCount: imported.endpointCount,
        exampleCount: imported.exampleCount,
        sizeBytes: imported.sizeBytes,
        sourceLabel: imported.sourceLabel,
      };
    },

    async create(ws: WorkspaceRef, userId: string, input: CreateMock): Promise<MockDetail> {
      await assertSlugUsable(ws, input.slug);
      if ((await mocksRepo.countInWorkspace(ws.id)) >= MAX_MOCKS_PER_WORKSPACE) {
        throw mockErrors.mockLimitReached();
      }
      const source = input.source;
      const custom = source.type === "custom";
      const imported = custom
        ? await importCustomEndpoints([], input.name)
        : await schemaImporter.import(source);
      try {
        await mocksRepo.createWithVersion(
          {
            workspaceId: ws.id,
            name: input.name,
            slug: input.slug,
            // Custom mocks have no schema to generate data from or validate against.
            responseMode: custom ? "static" : input.responseMode,
            validateRequests: custom ? false : input.validateRequests,
            cors: input.cors,
            sourceType: source.type,
            sourceUrl: source.type === "url" ? source.url : null,
            createdBy: userId,
          },
          versionInput(imported, {
            action: "create",
            restoredFrom: null,
            diff: null,
            createdBy: userId,
            customEndpoints: custom ? [] : null,
          }),
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw mockErrors.slugTaken(input.slug, ws.name);
        throw error;
      }
      // A 404 for this URL may be cached from before the mock existed.
      await dropRoutes(ws, input.slug);
      return loadDetail(ws, input.slug);
    },

    get(ws: WorkspaceRef, slug: string): Promise<MockDetail> {
      return loadDetail(ws, slug);
    },

    async update(
      ws: WorkspaceRef,
      userId: string,
      slug: string,
      patch: UpdateMock,
    ): Promise<MockDetail> {
      const current = await loadRecord(ws, slug);
      if (
        current.sourceType === "custom" &&
        (patch.responseMode === "dynamic" || patch.validateRequests === true)
      ) {
        throw mockErrors.customMockSetting();
      }
      const nextSlug = patch.slug ?? current.slug;
      if (nextSlug !== current.slug) await assertSlugUsable(ws, nextSlug);
      try {
        await mocksRepo.update(current.id, { ...patch, slug: nextSlug, updatedBy: userId });
      } catch (error) {
        if (isUniqueViolation(error)) throw mockErrors.slugTaken(nextSlug, ws.name);
        throw error;
      }
      // Old URL stops working immediately; the new one must not serve a
      // cached 404.
      await dropRoutes(ws, current.slug, nextSlug);
      return loadDetail(ws, nextSlug);
    },

    async remove(ws: WorkspaceRef, slug: string): Promise<void> {
      const current = await loadRecord(ws, slug);
      await mocksRepo.delete(current.id);
      await dropRoutes(ws, current.slug);
    },

    async listVersions(ws: WorkspaceRef, slug: string): Promise<MockVersion[]> {
      const current = await loadRecord(ws, slug);
      const versions = await mocksRepo.listVersions(current.id);
      return versions.map((version) => toMockVersion(version, current.liveVersionId));
    },

    // Request inputs per endpoint of the live version (the preview form).
    async listOperations(ws: WorkspaceRef, slug: string): Promise<OperationRequest[]> {
      const current = await loadRecord(ws, slug);
      return describeOperations(await versionOperations(current.liveVersionId));
    },

    // The live version's stored text: generated OpenAPI for custom mocks,
    // the uploaded/downloaded file for imported ones.
    async getSchema(ws: WorkspaceRef, slug: string): Promise<MockSchemaFile> {
      const current = await loadRecord(ws, slug);
      const source = await mocksRepo.findVersionSource(current.liveVersionId);
      if (!source) throw new NotFoundError("Version not found");
      const extension =
        current.sourceType === "custom"
          ? "openapi.json"
          : source.content.trimStart().startsWith("{")
            ? "json"
            : "yaml";
      return { filename: `${current.slug}.${extension}`, content: source.content };
    },

    async listCustomEndpoints(ws: WorkspaceRef, slug: string): Promise<CustomEndpointList> {
      const { current, endpoints } = await loadCustom(ws, slug);
      return {
        version: current.liveVersion.number,
        endpoints: endpoints.map(toCustomEndpointSummary),
      };
    },

    async getCustomEndpoint(
      ws: WorkspaceRef,
      slug: string,
      key: EndpointKey,
    ): Promise<CustomEndpointResult> {
      const { current, endpoints } = await loadCustom(ws, slug);
      const endpoint = endpoints[indexOf(endpoints, key)] as CustomEndpoint;
      return { version: current.liveVersion.number, endpoint };
    },

    async createCustomEndpoint(
      ws: WorkspaceRef,
      userId: string,
      slug: string,
      input: SaveCustomEndpoint,
    ): Promise<CustomEndpointResult> {
      const { current, endpoints } = await loadCustom(ws, slug);
      assertBaseVersion(current, input.baseVersion);
      const endpoint = normalizeEndpoint(input.endpoint);
      assertNoDuplicate(endpoints, endpoint);
      const version = await commitEndpoints(
        ws,
        userId,
        current,
        [...endpoints, endpoint],
        input.baseVersion,
      );
      return { version, endpoint };
    },

    // Replaces the whole endpoint; method/path may change (its overrides go dormant).
    async updateCustomEndpoint(
      ws: WorkspaceRef,
      userId: string,
      slug: string,
      key: EndpointKey,
      input: SaveCustomEndpoint,
    ): Promise<CustomEndpointResult> {
      const { current, endpoints } = await loadCustom(ws, slug);
      assertBaseVersion(current, input.baseVersion);
      const index = indexOf(endpoints, key);
      const endpoint = normalizeEndpoint(input.endpoint);
      assertNoDuplicate(
        endpoints.filter((_, i) => i !== index),
        endpoint,
      );
      const next = endpoints.map((item, i) => (i === index ? endpoint : item));
      const version = await commitEndpoints(ws, userId, current, next, input.baseVersion);
      return { version, endpoint };
    },

    async deleteCustomEndpoint(
      ws: WorkspaceRef,
      userId: string,
      slug: string,
      key: EndpointKey,
      baseVersion: number,
    ): Promise<void> {
      const { current, endpoints } = await loadCustom(ws, slug);
      assertBaseVersion(current, baseVersion);
      const index = indexOf(endpoints, key);
      await commitEndpoints(
        ws,
        userId,
        current,
        endpoints.filter((_, i) => i !== index),
        baseVersion,
      );
    },

    async replace(
      ws: WorkspaceRef,
      userId: string,
      slug: string,
      source: SchemaSource,
    ): Promise<MockDetail> {
      const current = await loadRecord(ws, slug);
      if (current.sourceType === "custom") throw mockErrors.mockNotImported();
      const imported = await schemaImporter.import(source);
      // Only changed content creates a version (spec Decision 9).
      if (imported.sha256 === current.liveVersion.contentSha256) return detailOf(ws, current);
      await mocksRepo.appendVersion(
        current.id,
        versionInput(imported, {
          action: "replace",
          restoredFrom: null,
          diff: diffOperations(current.liveVersion.operations, imported.operations),
          createdBy: userId,
          customEndpoints: null,
        }),
        {
          sourceType: source.type,
          sourceUrl: source.type === "url" ? source.url : null,
          updatedBy: userId,
        },
      );
      await dropRoutes(ws, slug);
      return loadDetail(ws, slug);
    },

    async resync(ws: WorkspaceRef, userId: string, slug: string): Promise<ResyncResult> {
      const current = await loadRecord(ws, slug);
      if (current.sourceType === "custom") throw mockErrors.mockNotImported();
      if (current.sourceType !== "url" || current.sourceUrl === null) {
        throw mockErrors.notUrlSource();
      }
      const imported = await schemaImporter.import({ type: "url", url: current.sourceUrl });
      if (imported.sha256 === current.liveVersion.contentSha256) {
        return { changed: false, mock: detailOf(ws, current) };
      }
      await mocksRepo.appendVersion(
        current.id,
        versionInput(imported, {
          action: "resync",
          restoredFrom: null,
          diff: diffOperations(current.liveVersion.operations, imported.operations),
          createdBy: userId,
          customEndpoints: null,
        }),
        { updatedBy: userId },
      );
      await dropRoutes(ws, slug);
      return { changed: true, mock: await loadDetail(ws, slug) };
    },

    async restore(
      ws: WorkspaceRef,
      userId: string,
      slug: string,
      number: number,
    ): Promise<MockDetail> {
      const current = await loadRecord(ws, slug);
      const target = await mocksRepo.findVersionByNumber(current.id, number);
      if (!target) throw new NotFoundError("Version not found");
      if (target.contentSha256 === current.liveVersion.contentSha256) return detailOf(ws, current);
      await mocksRepo.appendVersion(
        current.id,
        versionInput(
          { ...target, sha256: target.contentSha256 },
          {
            action: "restore",
            restoredFrom: target.number,
            diff: diffOperations(current.liveVersion.operations, target.operations),
            createdBy: userId,
            customEndpoints: target.customEndpoints,
          },
        ),
        { updatedBy: userId },
      );
      await dropRoutes(ws, slug);
      return loadDetail(ws, slug);
    },

    // Every saved response of the mock, dormant ones included (the UI shows
    // only rows matching a live operation).
    async listOverrides(ws: WorkspaceRef, slug: string): Promise<MockOverride[]> {
      const current = await loadRecord(ws, slug);
      return (await overridesRepo.list(current.id)).map(toMockOverride);
    },

    // Checks run in spec order: target, no-body status, size, JSON. No response-schema check —
    // off-schema bodies are allowed and served verbatim.
    async saveOverride(
      ws: WorkspaceRef,
      userId: string,
      slug: string,
      input: SaveMockOverride,
    ): Promise<MockOverride> {
      const current = await loadRecord(ws, slug);
      const { body, ...key } = input;
      const operation = current.liveVersion.operations.find(
        (op) => op.method === key.method && op.path === key.path,
      );
      if (!operation?.codes.includes(String(key.code))) throw mockErrors.overrideTargetUnknown(key);
      // The runtime sends these statuses without a body; a saved one would be silently dropped.
      if (NO_BODY_STATUS_CODES.includes(key.code)) throw mockErrors.overrideNoBodyStatus(key.code);
      if (Buffer.byteLength(body) > MAX_OVERRIDE_BODY_BYTES) throw mockErrors.overrideTooLarge();
      try {
        JSON.parse(body);
      } catch {
        throw mockErrors.overrideInvalidJson();
      }
      const saved = await overridesRepo.upsert(current.id, key, body, userId);
      // The runtime may hold a cached miss (or the old body) for this target.
      await invalidate(mockOverrideCacheKey(current.id, key));
      return toMockOverride(saved);
    },

    // Idempotent: resetting a target with nothing saved is not an error.
    async resetOverride(ws: WorkspaceRef, slug: string, key: OverrideKey): Promise<void> {
      const current = await loadRecord(ws, slug);
      await overridesRepo.delete(current.id, key);
      await invalidate(mockOverrideCacheKey(current.id, key));
    },
  };
}

export type MocksService = ReturnType<typeof createMocksService>;
