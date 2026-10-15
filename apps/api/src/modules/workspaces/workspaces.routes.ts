import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateWorkspaceSchema,
  DeleteWorkspaceSchema,
  envelope,
  SlugAvailabilitySchema,
  TransferWorkspaceSchema,
  UpdateWorkspaceSchema,
  WorkspaceSchema,
} from "@starter/schemas";
import { createRouter, errorResponse, jsonBody, jsonContent } from "@/lib/openapi";
import { authMiddleware } from "@/middleware/auth";
import type { RequireWorkspaceMember } from "@/middleware/require-workspace-member";
import { requireWorkspaceRole } from "@/middleware/require-workspace-role";
import { OWNER_ROLES, WORKSPACE_ADMIN_ROLES } from "./workspaces.constants";
import type { WorkspacesService } from "./workspaces.service";

const WsParamsSchema = z.object({
  ws: z.string().openapi({ param: { name: "ws", in: "path" }, example: "platform-team" }),
});

const SlugQuerySchema = z.object({
  slug: z.string().max(200).openapi({ example: "platform-team" }),
  ws: z
    .string()
    .optional()
    .openapi({ description: "Current workspace slug; its own old slugs count as free" }),
});

const AUTH_ERRORS = {
  401: errorResponse("Missing, invalid, or expired access token"),
  403: errorResponse("Account outside APP_GOOGLE_ALLOWED_HD (DOMAIN_NOT_ALLOWED)"),
} as const;

const SCOPED_ERRORS = {
  ...AUTH_ERRORS,
  403: errorResponse("Role too low (FORBIDDEN) or DOMAIN_NOT_ALLOWED"),
  404: errorResponse("Workspace not found (or not a member)"),
} as const;

export function createWorkspacesRoutes(
  service: WorkspacesService,
  requireWorkspaceMember: RequireWorkspaceMember,
) {
  const router = createRouter();
  // Per-route (not router.use): several routers share the /workspaces mount.
  // Mutable arrays on purpose: spread through a base, a readonly tuple no
  // longer satisfies RouteConfig.middleware.
  const base = {
    tags: ["workspaces"],
    security: [{ bearerAuth: [] }],
    middleware: [authMiddleware()],
  };
  const memberBase = { ...base, middleware: [authMiddleware(), requireWorkspaceMember] };
  const adminBase = {
    ...base,
    middleware: [
      authMiddleware(),
      requireWorkspaceMember,
      requireWorkspaceRole(WORKSPACE_ADMIN_ROLES),
    ],
  };
  const ownerBase = {
    ...base,
    middleware: [authMiddleware(), requireWorkspaceMember, requireWorkspaceRole(OWNER_ROLES)],
  };

  const listWorkspacesRoute = createRoute({
    ...base,
    method: "get",
    path: "/",
    operationId: "listWorkspaces",
    summary: "List my workspaces",
    description:
      "Creates the caller's personal workspace when they belong to none. Ordered last used first, then by recent activity.",
    responses: {
      200: jsonContent(envelope(z.array(WorkspaceSchema)), "Workspaces, last used first"),
      ...AUTH_ERRORS,
    },
  });

  const createWorkspaceRoute = createRoute({
    ...base,
    method: "post",
    path: "/",
    operationId: "createWorkspace",
    summary: "Create a workspace",
    request: jsonBody(CreateWorkspaceSchema),
    responses: {
      201: jsonContent(envelope(WorkspaceSchema), "Created; the caller is its Owner"),
      400: errorResponse("Invalid body or SLUG_INVALID"),
      409: errorResponse("SLUG_TAKEN, SLUG_RESERVED or WORKSPACE_LIMIT_REACHED"),
      ...AUTH_ERRORS,
    },
  });

  const checkSlugRoute = createRoute({
    ...base,
    method: "get",
    path: "/slug-available",
    operationId: "checkWorkspaceSlug",
    summary: "Check whether a workspace slug is free",
    request: { query: SlugQuerySchema },
    responses: {
      200: jsonContent(envelope(SlugAvailabilitySchema), "Availability"),
      ...AUTH_ERRORS,
    },
  });

  const updateWorkspaceRoute = createRoute({
    ...adminBase,
    method: "patch",
    path: "/{ws}",
    operationId: "updateWorkspace",
    summary: "Rename, change the URL prefix, join rule or new-mock defaults",
    request: { params: WsParamsSchema, ...jsonBody(UpdateWorkspaceSchema) },
    responses: {
      200: jsonContent(envelope(WorkspaceSchema), "Updated"),
      400: errorResponse("Invalid body, SLUG_INVALID or DOMAIN_JOIN_UNAVAILABLE"),
      409: errorResponse("SLUG_TAKEN or SLUG_RESERVED"),
      ...SCOPED_ERRORS,
    },
  });

  const deleteWorkspaceRoute = createRoute({
    ...ownerBase,
    method: "delete",
    path: "/{ws}",
    operationId: "deleteWorkspace",
    summary: "Delete a workspace",
    description: "Soft delete: mocks stop answering now; the data is purged after 30 days.",
    request: { params: WsParamsSchema, ...jsonBody(DeleteWorkspaceSchema) },
    responses: {
      204: { description: "Deleted" },
      400: errorResponse("Invalid body or CONFIRM_MISMATCH"),
      409: errorResponse("LAST_WORKSPACE"),
      ...SCOPED_ERRORS,
    },
  });

  const transferWorkspaceRoute = createRoute({
    ...ownerBase,
    method: "post",
    path: "/{ws}/transfer",
    operationId: "transferWorkspace",
    summary: "Make an Admin the owner",
    request: { params: WsParamsSchema, ...jsonBody(TransferWorkspaceSchema) },
    responses: {
      200: jsonContent(envelope(WorkspaceSchema), "The caller's view, now as Admin"),
      409: errorResponse("TRANSFER_TARGET_INVALID"),
      ...SCOPED_ERRORS,
    },
  });

  const leaveWorkspaceRoute = createRoute({
    ...memberBase,
    method: "post",
    path: "/{ws}/leave",
    operationId: "leaveWorkspace",
    summary: "Leave a workspace",
    request: { params: WsParamsSchema },
    responses: {
      204: { description: "Left" },
      409: errorResponse("OWNER_CANNOT_LEAVE"),
      ...SCOPED_ERRORS,
    },
  });

  router.openapi(listWorkspacesRoute, async (c) => {
    return c.json({ data: await service.listForUser(c.get("userId")) }, 200);
  });

  router.openapi(createWorkspaceRoute, async (c) => {
    const workspace = await service.create(c.get("userId"), c.req.valid("json"));
    return c.json({ data: workspace }, 201);
  });

  router.openapi(checkSlugRoute, async (c) => {
    const { slug, ws } = c.req.valid("query");
    return c.json({ data: await service.checkSlug(c.get("userId"), slug, ws) }, 200);
  });

  router.openapi(updateWorkspaceRoute, async (c) => {
    const workspace = await service.update(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("json"),
    );
    return c.json({ data: workspace }, 200);
  });

  router.openapi(deleteWorkspaceRoute, async (c) => {
    await service.remove(c.get("workspace"), c.get("userId"), c.req.valid("json").confirmSlug);
    return c.body(null, 204);
  });

  router.openapi(transferWorkspaceRoute, async (c) => {
    const workspace = await service.transfer(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("json").userId,
    );
    return c.json({ data: workspace }, 200);
  });

  router.openapi(leaveWorkspaceRoute, async (c) => {
    await service.leave(c.get("workspace"), c.get("userId"));
    return c.body(null, 204);
  });

  return router;
}
