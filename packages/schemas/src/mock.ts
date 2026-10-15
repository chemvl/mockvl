import { z } from "@hono/zod-openapi";
import type { ResourceField } from "./resource";

export const MOCK_STATUSES = ["running", "paused"] as const;
export const MockStatusSchema = z.enum(MOCK_STATUSES).openapi("MockStatus");
export type MockStatus = z.infer<typeof MockStatusSchema>;

export const MOCK_RESPONSE_MODES = ["static", "dynamic"] as const;
export const MockResponseModeSchema = z.enum(MOCK_RESPONSE_MODES).openapi("MockResponseMode");
export type MockResponseMode = z.infer<typeof MockResponseModeSchema>;

export const MOCK_SOURCE_TYPES = ["file", "url", "custom"] as const;
export const MockSourceTypeSchema = z.enum(MOCK_SOURCE_TYPES).openapi("MockSourceType");
export type MockSourceType = z.infer<typeof MockSourceTypeSchema>;

export const SCHEMA_FORMATS = ["openapi3", "postman2"] as const;
export const SchemaFormatSchema = z.enum(SCHEMA_FORMATS).openapi("SchemaFormat");
export type SchemaFormat = z.infer<typeof SchemaFormatSchema>;

export const MOCK_VERSION_ACTIONS = ["create", "replace", "resync", "restore", "edit"] as const;
export const MockVersionActionSchema = z.enum(MOCK_VERSION_ACTIONS).openapi("MockVersionAction");
export type MockVersionAction = z.infer<typeof MockVersionActionSchema>;

export const OPERATION_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;
export const OperationMethodSchema = z.enum(OPERATION_METHODS).openapi("OperationMethod");
export type OperationMethod = z.infer<typeof OperationMethodSchema>;

const isoDate = z.iso.datetime().openapi({ example: "2026-10-07T00:00:00.000Z" });

export const OperationSummarySchema = z
  .object({
    method: OperationMethodSchema,
    path: z.string().openapi({ example: "/pets/{id}" }),
    summary: z.string().nullable(),
    codes: z.array(z.string()).openapi({ example: ["200", "404"] }),
    examples: z.array(z.string()).openapi({ example: ["default", "rex"] }),
    examplesHash: z.string(),
  })
  .openapi("OperationSummary");
export type OperationSummary = z.infer<typeof OperationSummarySchema>;

// What a client needs to build a request for one operation (the endpoint
// preview form). `schema` is the parameter's / body's JSON Schema as Prism
// normalized it; recursive $refs stay as `{ "$ref": "#/__bundled__/…" }`.
// `examples` are literal example values (possibly empty).
const JsonSchemaSchema = z.record(z.string(), z.unknown()).nullable();

export const OperationParameterSchema = z
  .object({
    name: z.string().openapi({ example: "limit" }),
    required: z.boolean(),
    description: z.string().nullable(),
    schema: JsonSchemaSchema,
    examples: z.array(z.unknown()),
  })
  .openapi("OperationParameter");
export type OperationParameter = z.infer<typeof OperationParameterSchema>;

export const OperationRequestBodySchema = z
  .object({
    required: z.boolean(),
    mediaType: z.string().openapi({ example: "application/json" }),
    schema: JsonSchemaSchema,
    examples: z.array(z.unknown()),
  })
  .openapi("OperationRequestBody");
export type OperationRequestBody = z.infer<typeof OperationRequestBodySchema>;

export const OperationRequestSchema = z
  .object({
    method: OperationMethodSchema,
    path: z.string().openapi({ example: "/pets/{id}" }),
    parameters: z.object({
      path: z.array(OperationParameterSchema),
      query: z.array(OperationParameterSchema),
      header: z.array(OperationParameterSchema),
    }),
    body: OperationRequestBodySchema.nullable(),
  })
  .openapi("OperationRequest");
export type OperationRequest = z.infer<typeof OperationRequestSchema>;

export const VersionDiffSchema = z
  .object({
    endpointsAdded: z.number().int().min(0),
    endpointsRemoved: z.number().int().min(0),
    examplesChanged: z.number().int().min(0),
  })
  .openapi("VersionDiff");
export type VersionDiff = z.infer<typeof VersionDiffSchema>;

// The URL is only shape-checked here; "https only" and SSRF rules live in the
// import pipeline so the user gets the spec's SCHEMA_URL_* messages.
export const SchemaSourceSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("file"),
      filename: z.string().min(1).max(200).openapi({ example: "petstore.yaml" }),
      content: z.string().openapi({ description: "The file's text content" }),
    }),
    z.object({
      type: z.literal("url"),
      url: z.string().min(1).max(2048).openapi({ example: "https://example.com/openapi.json" }),
    }),
  ])
  .openapi("SchemaSource");
export type SchemaSource = z.infer<typeof SchemaSourceSchema>;

export const SchemaSourceRequestSchema = z
  .object({ source: SchemaSourceSchema })
  .openapi("SchemaSourceRequest");

// Blank mock: endpoints are added later (custom mocks spec). Only createMock
// accepts it; inspect and replace keep SchemaSource.
export const CustomSourceSchema = z.object({ type: z.literal("custom") }).openapi("CustomSource");

export const CreateMockSourceSchema = z
  .union([SchemaSourceSchema, CustomSourceSchema])
  .openapi("CreateMockSource");
export type CreateMockSource = z.infer<typeof CreateMockSourceSchema>;

export const SchemaInspectionSchema = z
  .object({
    format: SchemaFormatSchema,
    specVersion: z.string().openapi({ example: "3.1.0" }),
    endpointCount: z.number().int(),
    exampleCount: z.number().int(),
    sizeBytes: z.number().int(),
    sourceLabel: z.string(),
  })
  .openapi("SchemaInspection");
export type SchemaInspection = z.infer<typeof SchemaInspectionSchema>;

const MockNameSchema = z.string().trim().min(1).max(80);
// Slug rules are enforced by the service (SLUG_INVALID carries the spec
// message); the schema only caps junk.
const MockSlugInputSchema = z.string().max(200).openapi({ example: "pet-store" });

export const CreateMockSchema = z
  .object({
    name: MockNameSchema.openapi({ example: "Pet Store" }),
    slug: MockSlugInputSchema,
    responseMode: MockResponseModeSchema.default("static"),
    validateRequests: z.boolean().default(true),
    cors: z.boolean().default(true),
    source: CreateMockSourceSchema,
  })
  .openapi("CreateMock");
export type CreateMock = z.infer<typeof CreateMockSchema>;

export const UpdateMockSchema = z
  .object({
    name: MockNameSchema,
    slug: MockSlugInputSchema,
    responseMode: MockResponseModeSchema,
    validateRequests: z.boolean(),
    cors: z.boolean(),
    status: MockStatusSchema,
  })
  .partial()
  .openapi("UpdateMock");
export type UpdateMock = z.infer<typeof UpdateMockSchema>;

export const UserRefSchema = z
  .object({
    id: z.uuid(),
    name: z.string().nullable(),
    email: z.string(),
  })
  .openapi("UserRef");
export type UserRef = z.infer<typeof UserRefSchema>;

export const MockListItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    url: z.string().openapi({ example: "https://app.example.com/m/jane/pet-store" }),
    status: MockStatusSchema,
    endpointCount: z.number().int(),
    requests24h: z.number().int(),
    updatedAt: isoDate,
    updatedBy: UserRefSchema.nullable(),
  })
  .openapi("MockListItem");
export type MockListItem = z.infer<typeof MockListItemSchema>;

export const LiveVersionSchema = z
  .object({
    number: z.number().int(),
    format: SchemaFormatSchema,
    specVersion: z.string(),
    sourceLabel: z.string(),
    createdAt: isoDate,
    exampleCount: z.number().int(),
    sizeBytes: z.number().int(),
  })
  .openapi("LiveVersion");
export type LiveVersion = z.infer<typeof LiveVersionSchema>;

export const MockDetailSchema = MockListItemSchema.extend({
  responseMode: MockResponseModeSchema,
  validateRequests: z.boolean(),
  cors: z.boolean(),
  sourceType: MockSourceTypeSchema,
  sourceUrl: z.string().nullable(),
  liveVersion: LiveVersionSchema,
  versionCount: z.number().int(),
  operations: z.array(OperationSummarySchema),
  createdAt: isoDate,
  createdBy: UserRefSchema.nullable(),
}).openapi("MockDetail");
export type MockDetail = z.infer<typeof MockDetailSchema>;

export const MockVersionSchema = z
  .object({
    number: z.number().int(),
    action: MockVersionActionSchema,
    sourceLabel: z.string(),
    restoredFrom: z.number().int().nullable(),
    diff: VersionDiffSchema.nullable(),
    endpointCount: z.number().int(),
    createdAt: isoDate,
    createdBy: UserRefSchema.nullable(),
    live: z.boolean(),
  })
  .openapi("MockVersion");
export type MockVersion = z.infer<typeof MockVersionSchema>;

export const SlugAvailabilitySchema = z
  .object({
    slug: z.string(),
    available: z.boolean(),
    reason: z.enum(["taken", "invalid", "reserved"]).nullable(),
  })
  .openapi("SlugAvailability");
export type SlugAvailability = z.infer<typeof SlugAvailabilitySchema>;

export const ResyncResultSchema = z
  .object({ changed: z.boolean(), mock: MockDetailSchema })
  .openapi("ResyncResult");
export type ResyncResult = z.infer<typeof ResyncResultSchema>;

// Saved custom responses (spec 2026-10-08-mock-response-overrides). One per
// (mock, method, path template, status code). The key travels in the body or
// query because path templates contain `/`.
const overrideKeyShape = {
  method: OperationMethodSchema,
  path: z.string().min(1).max(2000).openapi({ example: "/pets/{id}" }),
  code: z.number().int().min(100).max(599).openapi({ example: 200 }),
};

export const SaveMockOverrideSchema = z
  .object({
    ...overrideKeyShape,
    // Size and JSON checks are the service's (spec error codes and messages).
    body: z.string().openapi({ example: '{\n  "id": 1\n}' }),
  })
  .openapi("SaveMockOverride");
export type SaveMockOverride = z.infer<typeof SaveMockOverrideSchema>;

export const MockOverrideSchema = z
  .object({ ...overrideKeyShape, updatedAt: isoDate, updatedBy: UserRefSchema.nullable() })
  .openapi("MockOverride");
export type MockOverride = z.infer<typeof MockOverrideSchema>;

// List contract allow-list for GET /workspaces/{ws}/mocks. createdBy accepts
// only `eq` + the literal "me" — enforced by the mocks service.
export const mockListFields: ResourceField[] = [
  { name: "name", type: "string", label: "Name", sortable: true },
  {
    name: "status",
    type: "enum",
    label: "Status",
    options: [...MOCK_STATUSES],
    filterable: true,
  },
  { name: "createdBy", type: "string", label: "Created by", filterable: true },
  { name: "updatedAt", type: "date", label: "Updated", sortable: true },
  { name: "createdAt", type: "date", label: "Created", sortable: true },
];

// Row shape for the read-only admin `mocks` resource — the raw table row.
// Spec content and operations live in mock_versions and are never exposed here.
export const MockAdminSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    name: z.string().openapi({ example: "Pet Store" }),
    slug: z.string().openapi({ example: "pet-store" }),
    status: MockStatusSchema,
    responseMode: MockResponseModeSchema,
    validateRequests: z.boolean(),
    cors: z.boolean(),
    sourceType: MockSourceTypeSchema,
    sourceUrl: z.string().nullable(),
    liveVersionId: z.uuid().nullable(),
    createdBy: z.uuid().nullable(),
    updatedBy: z.uuid().nullable(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .openapi("MockAdmin");
export type MockAdmin = z.infer<typeof MockAdminSchema>;

// Admin registry metadata for the read-only `mocks` resource (list/get only) —
// not to be confused with mockListFields, the public /workspaces/{ws}/mocks
// contract. Every field is readOnly and a list column (no form, no show page).
export const mockFields: ResourceField[] = [
  {
    name: "name",
    type: "string",
    label: "Name",
    listColumn: true,
    searchable: true,
    readOnly: true,
  },
  {
    name: "slug",
    type: "string",
    label: "Slug",
    listColumn: true,
    searchable: true,
    readOnly: true,
  },
  // Slug, not name: slugs are unique, names repeat ("… (personal)").
  {
    name: "workspaceId",
    type: "relation",
    label: "Workspace",
    resource: "workspaces",
    displayField: "slug",
    listColumn: true,
    filterable: true,
    readOnly: true,
  },
  {
    name: "status",
    type: "enum",
    label: "Status",
    options: [...MOCK_STATUSES],
    listColumn: true,
    filterable: true,
    readOnly: true,
  },
  {
    name: "responseMode",
    type: "enum",
    label: "Response mode",
    options: [...MOCK_RESPONSE_MODES],
    listColumn: true,
    filterable: true,
    readOnly: true,
  },
  {
    name: "validateRequests",
    type: "boolean",
    label: "Validate requests",
    listColumn: true,
    readOnly: true,
  },
  { name: "cors", type: "boolean", label: "CORS", listColumn: true, readOnly: true },
  {
    name: "sourceType",
    type: "enum",
    label: "Source",
    options: [...MOCK_SOURCE_TYPES],
    listColumn: true,
    filterable: true,
    readOnly: true,
  },
  { name: "sourceUrl", type: "string", label: "Source URL", listColumn: true, readOnly: true },
  // liveVersionId has no field: mock_versions is not an admin resource, so a
  // relation column would fall back to a raw id.
  {
    name: "createdBy",
    type: "relation",
    label: "Created by",
    resource: "users",
    displayField: "email",
    listColumn: true,
    filterable: true,
    readOnly: true,
  },
  {
    name: "updatedAt",
    type: "date",
    label: "Updated",
    listColumn: true,
    sortable: true,
    readOnly: true,
  },
  {
    name: "createdAt",
    type: "date",
    label: "Created",
    listColumn: true,
    sortable: true,
    readOnly: true,
  },
];
