import { createRoute, z } from "@hono/zod-openapi";
import { envelope, UpdateWorkspaceMemberSchema, WorkspaceMemberSchema } from "@starter/schemas";
import { createRouter, errorResponse, jsonBody, jsonContent } from "@/lib/openapi";
import { authMiddleware } from "@/middleware/auth";
import type { RequireWorkspaceMember } from "@/middleware/require-workspace-member";
import { requireWorkspaceRole } from "@/middleware/require-workspace-role";
import type { MembersService } from "./members.service";
import { WORKSPACE_ADMIN_ROLES } from "./workspaces.constants";

const WsParamsSchema = z.object({
  ws: z.string().openapi({ param: { name: "ws", in: "path" }, example: "platform-team" }),
});

const MemberParamsSchema = WsParamsSchema.extend({
  userId: z.uuid().openapi({
    param: { name: "userId", in: "path" },
    example: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a",
  }),
});

const SCOPED_ERRORS = {
  401: errorResponse("Missing, invalid, or expired access token"),
  403: errorResponse("Account outside APP_GOOGLE_ALLOWED_HD (DOMAIN_NOT_ALLOWED)"),
  404: errorResponse("Workspace not found (or not a member)"),
} as const;

const MANAGE_ERRORS = {
  ...SCOPED_ERRORS,
  403: errorResponse(
    "Role too low, target is the owner or the caller (FORBIDDEN), or DOMAIN_NOT_ALLOWED",
  ),
  404: errorResponse("Workspace or member not found"),
} as const;

export function createMembersRoutes(
  service: MembersService,
  requireWorkspaceMember: RequireWorkspaceMember,
) {
  const router = createRouter();
  // Per-route (not router.use): several routers share the /workspaces mount.
  const memberBase = {
    tags: ["workspaces"],
    security: [{ bearerAuth: [] }],
    middleware: [authMiddleware(), requireWorkspaceMember],
  };
  const adminBase = {
    ...memberBase,
    middleware: [
      authMiddleware(),
      requireWorkspaceMember,
      requireWorkspaceRole(WORKSPACE_ADMIN_ROLES),
    ],
  };

  const listMembersRoute = createRoute({
    ...memberBase,
    method: "get",
    path: "/{ws}/members",
    operationId: "listWorkspaceMembers",
    summary: "List workspace members",
    description: "Ordered Owner, Admin, Editor, Viewer, then by name (email when unnamed).",
    request: { params: WsParamsSchema },
    responses: {
      200: jsonContent(envelope(z.array(WorkspaceMemberSchema)), "Members"),
      ...SCOPED_ERRORS,
    },
  });

  const updateMemberRoute = createRoute({
    ...adminBase,
    method: "patch",
    path: "/{ws}/members/{userId}",
    operationId: "updateWorkspaceMember",
    summary: "Change a member's role",
    request: { params: MemberParamsSchema, ...jsonBody(UpdateWorkspaceMemberSchema) },
    responses: {
      200: jsonContent(envelope(WorkspaceMemberSchema), "Updated member"),
      400: errorResponse("Invalid body or userId"),
      ...MANAGE_ERRORS,
    },
  });

  const removeMemberRoute = createRoute({
    ...adminBase,
    method: "delete",
    path: "/{ws}/members/{userId}",
    operationId: "removeWorkspaceMember",
    summary: "Remove a member",
    description: "Domain join won't re-add them.",
    request: { params: MemberParamsSchema },
    responses: {
      204: { description: "Removed" },
      400: errorResponse("Invalid userId"),
      ...MANAGE_ERRORS,
    },
  });

  router.openapi(listMembersRoute, async (c) => {
    return c.json({ data: await service.list(c.get("workspace")) }, 200);
  });

  router.openapi(updateMemberRoute, async (c) => {
    const member = await service.updateRole(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("param").userId,
      c.req.valid("json").role,
    );
    return c.json({ data: member }, 200);
  });

  router.openapi(removeMemberRoute, async (c) => {
    await service.remove(c.get("workspace"), c.get("userId"), c.req.valid("param").userId);
    return c.body(null, 204);
  });

  return router;
}
