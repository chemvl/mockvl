import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateMockSchema,
  CustomEndpointListSchema,
  CustomEndpointResultSchema,
  envelope,
  listEnvelope,
  MOCK_STATUSES,
  MockDetailSchema,
  MockListItemSchema,
  MockOverrideSchema,
  MockSchemaFileSchema,
  MockVersionSchema,
  mockListFields,
  OperationMethodSchema,
  OperationRequestSchema,
  ResyncResultSchema,
  SaveCustomEndpointSchema,
  SaveMockOverrideSchema,
  SchemaInspectionSchema,
  SchemaSourceRequestSchema,
  SlugAvailabilitySchema,
  UpdateMockSchema,
} from "@starter/schemas";
import { createRouter, errorResponse, jsonBody, jsonContent } from "@/lib/openapi";
import { parseListQuery } from "@/lib/pagination";
import { authMiddleware } from "@/middleware/auth";
import type { RequireWorkspaceMember } from "@/middleware/require-workspace-member";
import { requireWorkspaceRole } from "@/middleware/require-workspace-role";
import { MOCK_EDITOR_ROLES } from "@/modules/workspaces/workspaces.constants";
import type { MocksService } from "./mocks.service";

const WsParamsSchema = z.object({
  ws: z.string().openapi({ param: { name: "ws", in: "path" }, example: "jane" }),
});
const MockParamsSchema = WsParamsSchema.extend({
  slug: z.string().openapi({ param: { name: "slug", in: "path" }, example: "pet-store" }),
});
const VersionParamsSchema = MockParamsSchema.extend({
  number: z.coerce
    .number()
    .int()
    .min(1)
    .openapi({ param: { name: "number", in: "path" }, example: 2 }),
});

// Documents the list contract for the generated SDK; real parsing is
// parseListQuery over the raw query (allow-listed by mockListFields).
const ListMocksQuerySchema = z.object({
  q: z.string().optional().openapi({ description: "Search name and slug" }),
  page: z.string().optional().openapi({ example: "1" }),
  pageSize: z.string().optional().openapi({ example: "20", description: "Max 100" }),
  sort: z
    .string()
    .optional()
    .openapi({ example: "updatedAt:desc", description: "name | updatedAt | createdAt" }),
  "filter[status][eq]": z.enum(MOCK_STATUSES).optional(),
  "filter[createdBy][eq]": z.literal("me").optional(),
});

const SlugQuerySchema = z.object({ slug: z.string().max(200).openapi({ example: "pet-store" }) });

// DELETE …/overrides key: query strings carry the code as text.
const OverrideKeyQuerySchema = z.object({
  method: OperationMethodSchema,
  path: z.string().min(1).max(2000).openapi({ example: "/pets/{id}" }),
  code: z.coerce.number().int().min(100).max(599).openapi({ example: 200 }),
});

// Custom endpoint key: query strings, because path templates contain "/".
const EndpointKeyQuerySchema = z.object({
  method: OperationMethodSchema,
  path: z.string().min(1).max(2000).openapi({ example: "/users/{id}" }),
});
const DeleteEndpointQuerySchema = EndpointKeyQuerySchema.extend({
  baseVersion: z.coerce.number().int().min(1).openapi({ example: 3 }),
});

const COMMON_ERRORS = {
  401: errorResponse("Missing, invalid, or expired access token"),
  403: errorResponse("Account outside APP_GOOGLE_ALLOWED_HD (DOMAIN_NOT_ALLOWED)"),
  404: errorResponse("Workspace or mock not found (or not a member)"),
} as const;

export function createMocksRoutes(
  service: MocksService,
  requireWorkspaceMember: RequireWorkspaceMember,
) {
  // Per-route (not router.use) because several routers share the
  // /workspaces mount and Hono merges their middleware into one tree.
  // Mutable on purpose: spread through `base`, a readonly tuple no longer
  // satisfies RouteConfig.middleware (inline `as const` only works in place).
  const guard = [authMiddleware(), requireWorkspaceMember];
  const base = { tags: ["mocks"], security: [{ bearerAuth: [] }], middleware: guard };
  // Mutations: Viewers can read and call mocks but not change them.
  const editorBase = {
    ...base,
    middleware: [authMiddleware(), requireWorkspaceMember, requireWorkspaceRole(MOCK_EDITOR_ROLES)],
  };
  const EDITOR_ERRORS = {
    ...COMMON_ERRORS,
    403: errorResponse("Role can't change mocks (FORBIDDEN) or DOMAIN_NOT_ALLOWED"),
  } as const;

  const listMocksRoute = createRoute({
    ...base,
    method: "get",
    path: "/{ws}/mocks",
    operationId: "listMocks",
    summary: "List mocks in a workspace",
    request: { params: WsParamsSchema, query: ListMocksQuerySchema },
    responses: {
      200: jsonContent(listEnvelope(MockListItemSchema), "A page of mocks"),
      400: errorResponse("Invalid list query"),
      ...COMMON_ERRORS,
    },
  });

  const checkSlugRoute = createRoute({
    ...base,
    method: "get",
    path: "/{ws}/mocks/slug-availability",
    operationId: "checkMockSlug",
    summary: "Check whether a mock slug is free",
    request: { params: WsParamsSchema, query: SlugQuerySchema },
    responses: {
      200: jsonContent(envelope(SlugAvailabilitySchema), "Availability"),
      ...COMMON_ERRORS,
    },
  });

  const inspectRoute = createRoute({
    ...editorBase,
    method: "post",
    path: "/{ws}/schema/inspect",
    operationId: "inspectSchema",
    summary: "Validate a schema source without creating anything",
    request: { params: WsParamsSchema, ...jsonBody(SchemaSourceRequestSchema) },
    responses: {
      200: jsonContent(envelope(SchemaInspectionSchema), "What would be imported"),
      400: errorResponse("SCHEMA_* import error"),
      413: errorResponse("Body over 6 MiB"),
      ...EDITOR_ERRORS,
    },
  });

  const createMockRoute = createRoute({
    ...editorBase,
    method: "post",
    path: "/{ws}/mocks",
    operationId: "createMock",
    summary: "Create a mock from a schema, or a blank custom mock",
    request: { params: WsParamsSchema, ...jsonBody(CreateMockSchema) },
    responses: {
      201: jsonContent(envelope(MockDetailSchema), "Created"),
      400: errorResponse("SCHEMA_* import error or SLUG_INVALID"),
      409: errorResponse("SLUG_TAKEN or MOCK_LIMIT_REACHED"),
      413: errorResponse("Body over 6 MiB"),
      ...EDITOR_ERRORS,
    },
  });

  const getMockRoute = createRoute({
    ...base,
    method: "get",
    path: "/{ws}/mocks/{slug}",
    operationId: "getMock",
    summary: "Get a mock",
    request: { params: MockParamsSchema },
    responses: { 200: jsonContent(envelope(MockDetailSchema), "The mock"), ...COMMON_ERRORS },
  });

  const updateMockRoute = createRoute({
    ...editorBase,
    method: "patch",
    path: "/{ws}/mocks/{slug}",
    operationId: "updateMock",
    summary: "Rename, change slug or behavior, pause/resume",
    request: { params: MockParamsSchema, ...jsonBody(UpdateMockSchema) },
    responses: {
      200: jsonContent(envelope(MockDetailSchema), "Updated"),
      400: errorResponse("Invalid body, SLUG_INVALID or CUSTOM_MOCK_SETTING"),
      409: errorResponse("SLUG_TAKEN"),
      ...EDITOR_ERRORS,
    },
  });

  const deleteMockRoute = createRoute({
    ...editorBase,
    method: "delete",
    path: "/{ws}/mocks/{slug}",
    operationId: "deleteMock",
    summary: "Delete a mock and its versions",
    request: { params: MockParamsSchema },
    responses: { 204: { description: "Deleted" }, ...EDITOR_ERRORS },
  });

  const listVersionsRoute = createRoute({
    ...base,
    method: "get",
    path: "/{ws}/mocks/{slug}/versions",
    operationId: "listMockVersions",
    summary: "Version history, newest first",
    request: { params: MockParamsSchema },
    responses: {
      200: jsonContent(envelope(z.array(MockVersionSchema)), "Versions"),
      ...COMMON_ERRORS,
    },
  });

  const listOperationsRoute = createRoute({
    ...base,
    method: "get",
    path: "/{ws}/mocks/{slug}/operations",
    operationId: "listMockOperations",
    summary: "Request inputs (parameters, body) per endpoint of the live version",
    request: { params: MockParamsSchema },
    responses: {
      200: jsonContent(envelope(z.array(OperationRequestSchema)), "Endpoints, path then method"),
      ...COMMON_ERRORS,
    },
  });

  const getSchemaRoute = createRoute({
    ...base,
    method: "get",
    path: "/{ws}/mocks/{slug}/schema",
    operationId: "getMockSchema",
    summary: "The live version's schema file (generated OpenAPI 3.1 for custom mocks)",
    request: { params: MockParamsSchema },
    responses: {
      200: jsonContent(envelope(MockSchemaFileSchema), "Filename and content"),
      ...COMMON_ERRORS,
    },
  });

  const replaceRoute = createRoute({
    ...editorBase,
    method: "post",
    path: "/{ws}/mocks/{slug}/versions",
    operationId: "replaceMockSchema",
    summary: "Replace the schema (creates a version when content changed)",
    request: { params: MockParamsSchema, ...jsonBody(SchemaSourceRequestSchema) },
    responses: {
      200: jsonContent(envelope(MockDetailSchema), "The mock with its live version"),
      400: errorResponse("SCHEMA_* import error"),
      409: errorResponse("MOCK_NOT_IMPORTED"),
      413: errorResponse("Body over 6 MiB"),
      ...EDITOR_ERRORS,
    },
  });

  const resyncRoute = createRoute({
    ...editorBase,
    method: "post",
    path: "/{ws}/mocks/{slug}/resync",
    operationId: "resyncMock",
    summary: "Re-download a URL-sourced schema",
    request: { params: MockParamsSchema },
    responses: {
      200: jsonContent(envelope(ResyncResultSchema), "changed=false when content is identical"),
      400: errorResponse("SCHEMA_* import error"),
      409: errorResponse("NOT_URL_SOURCE or MOCK_NOT_IMPORTED"),
      ...EDITOR_ERRORS,
    },
  });

  const restoreRoute = createRoute({
    ...editorBase,
    method: "post",
    path: "/{ws}/mocks/{slug}/versions/{number}/restore",
    operationId: "restoreMockVersion",
    summary: "Restore an old version as a new live version",
    request: { params: VersionParamsSchema },
    responses: {
      200: jsonContent(envelope(MockDetailSchema), "The mock with its new live version"),
      ...EDITOR_ERRORS,
    },
  });

  const listOverridesRoute = createRoute({
    ...base,
    method: "get",
    path: "/{ws}/mocks/{slug}/overrides",
    operationId: "listMockOverrides",
    summary: "Saved custom responses (dormant ones included, no bodies)",
    request: { params: MockParamsSchema },
    responses: {
      200: jsonContent(
        envelope(z.array(MockOverrideSchema)),
        "Overrides, path then method then code",
      ),
      ...COMMON_ERRORS,
    },
  });

  const saveOverrideRoute = createRoute({
    ...editorBase,
    method: "put",
    path: "/{ws}/mocks/{slug}/overrides",
    operationId: "saveMockOverride",
    summary: "Save the response one endpoint + status code returns",
    request: { params: MockParamsSchema, ...jsonBody(SaveMockOverrideSchema) },
    responses: {
      200: jsonContent(envelope(MockOverrideSchema), "Saved"),
      400: errorResponse(
        "OVERRIDE_TARGET_UNKNOWN, OVERRIDE_NO_BODY_STATUS, OVERRIDE_TOO_LARGE or OVERRIDE_INVALID_JSON",
      ),
      ...EDITOR_ERRORS,
    },
  });

  const resetOverrideRoute = createRoute({
    ...editorBase,
    method: "delete",
    path: "/{ws}/mocks/{slug}/overrides",
    operationId: "resetMockOverride",
    summary: "Delete a saved response (idempotent)",
    request: { params: MockParamsSchema, query: OverrideKeyQuerySchema },
    responses: { 204: { description: "Reset, also when nothing was saved" }, ...EDITOR_ERRORS },
  });

  const ENDPOINT_404 = errorResponse("Workspace or mock not found, or ENDPOINT_NOT_FOUND");
  const ENDPOINT_WRITE_400 = errorResponse(
    "ENDPOINT_PATH_INVALID, RESPONSE_STATUS_INVALID, RESPONSE_INVALID_JSON, RESPONSE_TOO_LARGE or RESPONSE_HEADER_INVALID",
  );
  const ENDPOINT_WRITE_409 = errorResponse("MOCK_NOT_CUSTOM, VERSION_CONFLICT or ENDPOINT_EXISTS");

  const listEndpointsRoute = createRoute({
    ...base,
    method: "get",
    path: "/{ws}/mocks/{slug}/endpoints",
    operationId: "listCustomEndpoints",
    summary: "Custom mock endpoints of the live version (no bodies)",
    request: { params: MockParamsSchema },
    responses: {
      200: jsonContent(envelope(CustomEndpointListSchema), "Live version number and endpoints"),
      409: errorResponse("MOCK_NOT_CUSTOM"),
      ...COMMON_ERRORS,
    },
  });

  const getEndpointRoute = createRoute({
    ...base,
    method: "get",
    path: "/{ws}/mocks/{slug}/endpoints/item",
    operationId: "getCustomEndpoint",
    summary: "One custom endpoint with its default bodies",
    request: { params: MockParamsSchema, query: EndpointKeyQuerySchema },
    responses: {
      200: jsonContent(envelope(CustomEndpointResultSchema), "Live version number and endpoint"),
      409: errorResponse("MOCK_NOT_CUSTOM"),
      ...COMMON_ERRORS,
      404: ENDPOINT_404,
    },
  });

  const createEndpointRoute = createRoute({
    ...editorBase,
    method: "post",
    path: "/{ws}/mocks/{slug}/endpoints",
    operationId: "createCustomEndpoint",
    summary: "Add an endpoint (creates a live version)",
    request: { params: MockParamsSchema, ...jsonBody(SaveCustomEndpointSchema) },
    responses: {
      201: jsonContent(
        envelope(CustomEndpointResultSchema),
        "New live version and stored endpoint",
      ),
      400: ENDPOINT_WRITE_400,
      409: ENDPOINT_WRITE_409,
      ...EDITOR_ERRORS,
    },
  });

  const updateEndpointRoute = createRoute({
    ...editorBase,
    method: "put",
    path: "/{ws}/mocks/{slug}/endpoints/item",
    operationId: "updateCustomEndpoint",
    summary: "Replace an endpoint, including its method or path (creates a live version)",
    request: {
      params: MockParamsSchema,
      query: EndpointKeyQuerySchema,
      ...jsonBody(SaveCustomEndpointSchema),
    },
    responses: {
      200: jsonContent(
        envelope(CustomEndpointResultSchema),
        "New live version and stored endpoint",
      ),
      400: ENDPOINT_WRITE_400,
      409: ENDPOINT_WRITE_409,
      ...EDITOR_ERRORS,
      404: ENDPOINT_404,
    },
  });

  const deleteEndpointRoute = createRoute({
    ...editorBase,
    method: "delete",
    path: "/{ws}/mocks/{slug}/endpoints/item",
    operationId: "deleteCustomEndpoint",
    summary: "Delete an endpoint (creates a live version)",
    request: { params: MockParamsSchema, query: DeleteEndpointQuerySchema },
    responses: {
      204: { description: "Deleted" },
      409: errorResponse("MOCK_NOT_CUSTOM or VERSION_CONFLICT"),
      ...EDITOR_ERRORS,
      404: ENDPOINT_404,
    },
  });

  const router = createRouter();

  router.openapi(listMocksRoute, async (c) => {
    const raw = c.req.query();
    const query = parseListQuery(raw, mockListFields);
    const { rows, total } = await service.list(c.get("workspace"), c.get("userId"), query, raw.q);
    return c.json({ data: rows, meta: { page: query.page, pageSize: query.pageSize, total } }, 200);
  });

  // Static segment before /{slug} — Hono matches in registration order.
  router.openapi(checkSlugRoute, async (c) => {
    const data = await service.checkSlug(c.get("workspace"), c.req.valid("query").slug);
    return c.json({ data }, 200);
  });

  router.openapi(inspectRoute, async (c) => {
    return c.json({ data: await service.inspect(c.req.valid("json").source) }, 200);
  });

  router.openapi(createMockRoute, async (c) => {
    const data = await service.create(c.get("workspace"), c.get("userId"), c.req.valid("json"));
    return c.json({ data }, 201);
  });

  router.openapi(getMockRoute, async (c) => {
    return c.json({ data: await service.get(c.get("workspace"), c.req.valid("param").slug) }, 200);
  });

  router.openapi(updateMockRoute, async (c) => {
    const data = await service.update(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("param").slug,
      c.req.valid("json"),
    );
    return c.json({ data }, 200);
  });

  router.openapi(deleteMockRoute, async (c) => {
    await service.remove(c.get("workspace"), c.req.valid("param").slug);
    return c.body(null, 204);
  });

  router.openapi(listVersionsRoute, async (c) => {
    const data = await service.listVersions(c.get("workspace"), c.req.valid("param").slug);
    return c.json({ data }, 200);
  });

  router.openapi(listOperationsRoute, async (c) => {
    const data = await service.listOperations(c.get("workspace"), c.req.valid("param").slug);
    return c.json({ data }, 200);
  });

  router.openapi(getSchemaRoute, async (c) => {
    const data = await service.getSchema(c.get("workspace"), c.req.valid("param").slug);
    return c.json({ data }, 200);
  });

  router.openapi(replaceRoute, async (c) => {
    const data = await service.replace(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("param").slug,
      c.req.valid("json").source,
    );
    return c.json({ data }, 200);
  });

  router.openapi(resyncRoute, async (c) => {
    const data = await service.resync(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("param").slug,
    );
    return c.json({ data }, 200);
  });

  router.openapi(restoreRoute, async (c) => {
    const { slug, number } = c.req.valid("param");
    const data = await service.restore(c.get("workspace"), c.get("userId"), slug, number);
    return c.json({ data }, 200);
  });

  router.openapi(listOverridesRoute, async (c) => {
    const data = await service.listOverrides(c.get("workspace"), c.req.valid("param").slug);
    return c.json({ data }, 200);
  });

  router.openapi(saveOverrideRoute, async (c) => {
    const data = await service.saveOverride(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("param").slug,
      c.req.valid("json"),
    );
    return c.json({ data }, 200);
  });

  router.openapi(resetOverrideRoute, async (c) => {
    await service.resetOverride(
      c.get("workspace"),
      c.req.valid("param").slug,
      c.req.valid("query"),
    );
    return c.body(null, 204);
  });

  router.openapi(listEndpointsRoute, async (c) => {
    const data = await service.listCustomEndpoints(c.get("workspace"), c.req.valid("param").slug);
    return c.json({ data }, 200);
  });

  router.openapi(getEndpointRoute, async (c) => {
    const data = await service.getCustomEndpoint(
      c.get("workspace"),
      c.req.valid("param").slug,
      c.req.valid("query"),
    );
    return c.json({ data }, 200);
  });

  router.openapi(createEndpointRoute, async (c) => {
    const data = await service.createCustomEndpoint(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("param").slug,
      c.req.valid("json"),
    );
    return c.json({ data }, 201);
  });

  router.openapi(updateEndpointRoute, async (c) => {
    const data = await service.updateCustomEndpoint(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("param").slug,
      c.req.valid("query"),
      c.req.valid("json"),
    );
    return c.json({ data }, 200);
  });

  router.openapi(deleteEndpointRoute, async (c) => {
    const { baseVersion, ...key } = c.req.valid("query");
    await service.deleteCustomEndpoint(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("param").slug,
      key,
      baseVersion,
    );
    return c.body(null, 204);
  });

  return router;
}
