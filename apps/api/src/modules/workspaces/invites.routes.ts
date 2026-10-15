import { createRoute, z } from "@hono/zod-openapi";
import {
  AcceptInviteResultSchema,
  CreateWorkspaceInvitesSchema,
  envelope,
  InviteLookupSchema,
  InviteResultSchema,
  WorkspaceInviteSchema,
} from "@starter/schemas";
import { createRouter, errorResponse, jsonBody, jsonContent } from "@/lib/openapi";
import { authMiddleware } from "@/middleware/auth";
import type { RequireWorkspaceMember } from "@/middleware/require-workspace-member";
import { requireWorkspaceRole } from "@/middleware/require-workspace-role";
import type { InvitesService } from "./invites.service";
import { WORKSPACE_ADMIN_ROLES } from "./workspaces.constants";

const WsParamsSchema = z.object({
  ws: z.string().openapi({ param: { name: "ws", in: "path" }, example: "platform-team" }),
});

const InviteParamsSchema = WsParamsSchema.extend({
  inviteId: z.uuid().openapi({
    param: { name: "inviteId", in: "path" },
    example: "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a",
  }),
});

const TokenParamsSchema = z.object({
  token: z
    .string()
    .min(1)
    .max(200)
    .openapi({ param: { name: "token", in: "path" }, description: "Token from the invite email" }),
});

const AUTH_ERRORS = {
  401: errorResponse("Missing, invalid, or expired access token"),
  403: errorResponse("Account outside APP_GOOGLE_ALLOWED_HD (DOMAIN_NOT_ALLOWED)"),
} as const;

const SCOPED_ERRORS = {
  ...AUTH_ERRORS,
  404: errorResponse("Workspace not found (or not a member)"),
} as const;

const MANAGE_ERRORS = {
  ...SCOPED_ERRORS,
  403: errorResponse("Role too low (FORBIDDEN) or DOMAIN_NOT_ALLOWED"),
} as const;

const TOKEN_ERRORS = {
  ...AUTH_ERRORS,
  404: errorResponse("Invite not found (unknown or superseded token, or deleted workspace)"),
} as const;

// /workspaces/{ws}/invites/…
export function createInvitesRoutes(
  service: InvitesService,
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

  const listInvitesRoute = createRoute({
    ...memberBase,
    method: "get",
    path: "/{ws}/invites",
    operationId: "listWorkspaceInvites",
    summary: "List pending invites",
    description: "Invites not yet accepted or revoked, newest first; expired ones included.",
    request: { params: WsParamsSchema },
    responses: {
      200: jsonContent(envelope(z.array(WorkspaceInviteSchema)), "Pending invites"),
      ...SCOPED_ERRORS,
    },
  });

  const createInvitesRoute = createRoute({
    ...adminBase,
    method: "post",
    path: "/{ws}/invites",
    operationId: "createWorkspaceInvites",
    summary: "Invite people by email",
    description:
      "One result per distinct email, in input order. An email with a pending invite gets it resent.",
    request: { params: WsParamsSchema, ...jsonBody(CreateWorkspaceInvitesSchema) },
    responses: {
      200: jsonContent(envelope(z.array(InviteResultSchema)), "Per-email results"),
      400: errorResponse("Invalid body or INVITE_BATCH_TOO_LARGE"),
      ...MANAGE_ERRORS,
    },
  });

  const resendInviteRoute = createRoute({
    ...adminBase,
    method: "post",
    path: "/{ws}/invites/{inviteId}/resend",
    operationId: "resendWorkspaceInvite",
    summary: "Resend an invite",
    description: "Issues a new link (the old one stops working) valid for 7 more days.",
    request: { params: InviteParamsSchema },
    responses: {
      200: jsonContent(envelope(WorkspaceInviteSchema), "Resent invite"),
      400: errorResponse("Invalid inviteId"),
      ...MANAGE_ERRORS,
      404: errorResponse("Workspace or pending invite not found"),
    },
  });

  const revokeInviteRoute = createRoute({
    ...adminBase,
    method: "delete",
    path: "/{ws}/invites/{inviteId}",
    operationId: "revokeWorkspaceInvite",
    summary: "Revoke an invite",
    request: { params: InviteParamsSchema },
    responses: {
      204: { description: "Revoked" },
      400: errorResponse("Invalid inviteId"),
      ...MANAGE_ERRORS,
      404: errorResponse("Workspace or pending invite not found"),
    },
  });

  router.openapi(listInvitesRoute, async (c) => {
    return c.json({ data: await service.list(c.get("workspace")) }, 200);
  });

  router.openapi(createInvitesRoute, async (c) => {
    const results = await service.create(c.get("workspace"), c.get("userId"), c.req.valid("json"));
    return c.json({ data: results }, 200);
  });

  router.openapi(resendInviteRoute, async (c) => {
    const invite = await service.resend(
      c.get("workspace"),
      c.get("userId"),
      c.req.valid("param").inviteId,
    );
    return c.json({ data: invite }, 200);
  });

  router.openapi(revokeInviteRoute, async (c) => {
    await service.revoke(c.get("workspace"), c.get("userId"), c.req.valid("param").inviteId);
    return c.body(null, 204);
  });

  return router;
}

// /invites/by-token/{token}/… — the accept-invite page. Any signed-in user
// may look a token up; only the invited account can accept it.
export function createInviteTokenRoutes(service: InvitesService) {
  const router = createRouter();
  const base = {
    tags: ["workspaces"],
    security: [{ bearerAuth: [] }],
    middleware: [authMiddleware()],
  };

  const getInviteRoute = createRoute({
    ...base,
    method: "get",
    path: "/by-token/{token}",
    operationId: "getInviteByToken",
    summary: "Look up an invite for the signed-in user",
    request: { params: TokenParamsSchema },
    responses: {
      200: jsonContent(envelope(InviteLookupSchema), "Invite and its state for the caller"),
      ...TOKEN_ERRORS,
    },
  });

  const acceptInviteRoute = createRoute({
    ...base,
    method: "post",
    path: "/by-token/{token}/accept",
    operationId: "acceptInvite",
    summary: "Accept an invite",
    description: "Already a member: returns the workspace without changes.",
    request: { params: TokenParamsSchema },
    responses: {
      200: jsonContent(envelope(AcceptInviteResultSchema), "The joined workspace"),
      ...TOKEN_ERRORS,
      403: errorResponse("INVITE_EMAIL_MISMATCH or DOMAIN_NOT_ALLOWED"),
      409: errorResponse("WORKSPACE_LIMIT_REACHED or MEMBER_LIMIT_REACHED"),
      410: errorResponse("INVITE_INVALID or INVITE_EXPIRED"),
    },
  });

  const declineInviteRoute = createRoute({
    ...base,
    method: "post",
    path: "/by-token/{token}/decline",
    operationId: "declineInvite",
    summary: "Decline an invite",
    description: "No-op when the invite is already closed or the caller is a member.",
    request: { params: TokenParamsSchema },
    responses: {
      204: { description: "Declined" },
      ...TOKEN_ERRORS,
      403: errorResponse("INVITE_EMAIL_MISMATCH or DOMAIN_NOT_ALLOWED"),
    },
  });

  router.openapi(getInviteRoute, async (c) => {
    const lookup = await service.lookup(c.get("userId"), c.req.valid("param").token);
    return c.json({ data: lookup }, 200);
  });

  router.openapi(acceptInviteRoute, async (c) => {
    const result = await service.accept(c.get("userId"), c.req.valid("param").token);
    return c.json({ data: result }, 200);
  });

  router.openapi(declineInviteRoute, async (c) => {
    await service.decline(c.get("userId"), c.req.valid("param").token);
    return c.body(null, 204);
  });

  return router;
}
