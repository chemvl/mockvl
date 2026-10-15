import { createRoute, z } from "@hono/zod-openapi";
import { envelope, listEnvelope } from "@starter/schemas";
import { createRouter, errorResponse, jsonBody, jsonContent } from "@/lib/openapi";
import { parseListQuery } from "@/lib/pagination";
import type { RequireAdmin } from "@/middleware/admin-auth";
import type { CrudService } from "./crud.service";
import type { AdminResourceDef, ResourceRow } from "./registry";

// Generic HTTP layer mounted once per registered resource at /admin/<name>.
// Every route is guarded by requireAdmin(def.permissions[action]); an action
// absent from the def's permissions is simply never mounted (404), so it also
// never appears in the meta payload and the frontend never renders it.

const IdParamsSchema = z.object({ id: z.uuid() });

// Documents the §4.2 convention for OpenAPI. filter[field][op] keys can't be
// a static Zod shape, so real validation lives in parseListQuery (which also
// allow-lists fields); this schema is deliberately permissive.
const ListQueryDocSchema = z.object({
  page: z.string().optional().openapi({ example: "1" }),
  pageSize: z.string().optional().openapi({ example: "20", description: "Max 100" }),
  sort: z.string().optional().openapi({ example: "createdAt:desc" }),
});

const LIST_QUERY_DESCRIPTION =
  "List query convention: `page`, `pageSize` (max 100), `sort=field:dir` (comma-separated " +
  "multi-sort), `filter[field]=value` (eq) or `filter[field][op]=value` with ops " +
  "`eq|like|in|gte|lte`. Sortable/filterable/searchable fields come from the resource metadata.";

// Rows leave the repo with Dates and every table column; the wire gets ISO
// strings and exactly the output schema — parse both validates and strips, so
// an undeclared column (e.g. a hash) can never leak through the generic engine.
function serializeRow(def: AdminResourceDef, row: ResourceRow): ResourceRow {
  const converted = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
  return def.schema.output.parse(converted);
}

export interface CreateCrudRoutesDeps {
  def: AdminResourceDef;
  service: CrudService;
  requireAdmin: RequireAdmin;
}

export function createCrudRoutes({ def, service, requireAdmin }: CreateCrudRoutesDeps) {
  const router = createRouter();
  const tag = `admin/${def.name}`;
  const output = def.schema.output;

  router.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: [tag],
      summary: `List ${def.label}`,
      description: LIST_QUERY_DESCRIPTION,
      security: [{ adminSession: [] }],
      middleware: [requireAdmin(def.permissions.list)] as const,
      request: { query: ListQueryDocSchema },
      responses: {
        200: jsonContent(listEnvelope(output), `A page of ${def.label}`),
        400: errorResponse("Invalid list query"),
        401: errorResponse("Admin session required"),
        403: errorResponse("Insufficient role"),
      },
    }),
    async (c) => {
      const query = parseListQuery(c.req.query(), def.fields);
      const { rows, total } = await service.list(query);
      return c.json(
        {
          data: rows.map((row) => serializeRow(def, row)),
          meta: { page: query.page, pageSize: query.pageSize, total },
        },
        200,
      );
    },
  );

  router.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: [tag],
      summary: `Get one of ${def.label}`,
      security: [{ adminSession: [] }],
      middleware: [requireAdmin(def.permissions.list)] as const,
      request: { params: IdParamsSchema },
      responses: {
        200: jsonContent(envelope(output), `One of ${def.label}`),
        400: errorResponse("Invalid id"),
        401: errorResponse("Admin session required"),
        403: errorResponse("Insufficient role"),
        404: errorResponse("Record not found"),
      },
    }),
    async (c) => {
      const row = await service.get(c.req.valid("param").id);
      return c.json({ data: serializeRow(def, row) }, 200);
    },
  );

  const createSchema = def.schema.create;
  if (def.permissions.create && createSchema) {
    router.openapi(
      createRoute({
        method: "post",
        path: "/",
        tags: [tag],
        summary: `Create ${def.label}`,
        security: [{ adminSession: [] }],
        middleware: [requireAdmin(def.permissions.create)] as const,
        request: jsonBody(createSchema),
        responses: {
          201: jsonContent(envelope(output), `The created ${def.label}`),
          400: errorResponse("Invalid body"),
          401: errorResponse("Admin session required"),
          403: errorResponse("Insufficient role or missing X-Requested-With"),
        },
      }),
      async (c) => {
        const row = await service.create(c.req.valid("json"));
        return c.json({ data: serializeRow(def, row) }, 201);
      },
    );
  }

  const updateSchema = def.schema.update;
  if (def.permissions.update && updateSchema) {
    router.openapi(
      createRoute({
        method: "patch",
        path: "/{id}",
        tags: [tag],
        summary: `Update ${def.label}`,
        security: [{ adminSession: [] }],
        middleware: [requireAdmin(def.permissions.update)] as const,
        request: { params: IdParamsSchema, ...jsonBody(updateSchema) },
        responses: {
          200: jsonContent(envelope(output), `The updated ${def.label}`),
          400: errorResponse("Invalid id or body"),
          401: errorResponse("Admin session required"),
          403: errorResponse("Insufficient role or missing X-Requested-With"),
          404: errorResponse("Record not found"),
        },
      }),
      async (c) => {
        const row = await service.update(c.req.valid("param").id, c.req.valid("json"));
        return c.json({ data: serializeRow(def, row) }, 200);
      },
    );
  }

  if (def.permissions.delete) {
    router.openapi(
      createRoute({
        method: "delete",
        path: "/{id}",
        tags: [tag],
        summary: `Delete ${def.label}`,
        security: [{ adminSession: [] }],
        middleware: [requireAdmin(def.permissions.delete)] as const,
        request: { params: IdParamsSchema },
        responses: {
          200: jsonContent(envelope(output), `The deleted ${def.label}`),
          400: errorResponse("Invalid id"),
          401: errorResponse("Admin session required"),
          403: errorResponse("Insufficient role or missing X-Requested-With"),
          404: errorResponse("Record not found"),
        },
      }),
      async (c) => {
        const row = await service.remove(c.req.valid("param").id);
        return c.json({ data: serializeRow(def, row) }, 200);
      },
    );
  }

  return router;
}
