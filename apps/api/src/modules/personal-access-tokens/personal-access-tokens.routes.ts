import { createRoute, z } from "@hono/zod-openapi";
import {
  CreatedPersonalAccessTokenSchema,
  CreatePersonalAccessTokenSchema,
  envelope,
  PersonalAccessTokenSchema,
} from "@starter/schemas";
import { createRouter, errorResponse, jsonBody, jsonContent } from "@/lib/openapi";
import { authMiddleware } from "@/middleware/auth";
import type { RequireWorkspaceMember } from "@/middleware/require-workspace-member";
import type { PersonalAccessTokensService } from "./personal-access-tokens.service";

const WsParamsSchema = z.object({
  ws: z.string().openapi({ param: { name: "ws", in: "path" }, example: "jane" }),
});
const TokenParamsSchema = WsParamsSchema.extend({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});

const COMMON_ERRORS = {
  401: errorResponse("Missing, invalid, or expired access token"),
  403: errorResponse("Account outside APP_GOOGLE_ALLOWED_HD (DOMAIN_NOT_ALLOWED)"),
  404: errorResponse("Workspace not found (or not a member)"),
} as const;

// Any member manages their own tokens; nobody sees another member's.
export function createPersonalAccessTokensRoutes(
  service: PersonalAccessTokensService,
  requireWorkspaceMember: RequireWorkspaceMember,
) {
  // Per-route (not router.use): several routers share the /workspaces mount.
  // JWT-only guard, so a personal access token can't mint or revoke tokens.
  const guard = [authMiddleware(), requireWorkspaceMember];
  const base = {
    tags: ["personal-access-tokens"],
    security: [{ bearerAuth: [] }],
    middleware: guard,
  };

  const listRoute = createRoute({
    ...base,
    method: "get",
    path: "/{ws}/personal-access-tokens",
    operationId: "listPersonalAccessTokens",
    summary: "List your unrevoked access tokens in a workspace",
    request: { params: WsParamsSchema },
    responses: {
      200: jsonContent(envelope(z.array(PersonalAccessTokenSchema)), "Your tokens"),
      ...COMMON_ERRORS,
    },
  });

  const createTokenRoute = createRoute({
    ...base,
    method: "post",
    path: "/{ws}/personal-access-tokens",
    operationId: "createPersonalAccessToken",
    summary: "Create an access token for the MCP endpoint",
    request: { params: WsParamsSchema, ...jsonBody(CreatePersonalAccessTokenSchema) },
    responses: {
      201: jsonContent(
        envelope(CreatedPersonalAccessTokenSchema),
        "Created; the plaintext token is shown only here",
      ),
      ...COMMON_ERRORS,
      403: errorResponse("Role can't create a write token (FORBIDDEN) or DOMAIN_NOT_ALLOWED"),
      409: errorResponse("TOKEN_LIMIT_REACHED"),
    },
  });

  const revokeRoute = createRoute({
    ...base,
    method: "delete",
    path: "/{ws}/personal-access-tokens/{id}",
    operationId: "revokePersonalAccessToken",
    summary: "Revoke one of your access tokens",
    request: { params: TokenParamsSchema },
    responses: {
      204: { description: "Revoked, also when it already was" },
      ...COMMON_ERRORS,
      404: errorResponse("Workspace or token not found"),
    },
  });

  const router = createRouter();

  router.openapi(listRoute, async (c) => {
    const data = await service.list(c.get("workspace"), c.get("userId"));
    return c.json({ data }, 200);
  });

  router.openapi(createTokenRoute, async (c) => {
    const data = await service.create(c.get("workspace"), c.get("userId"), c.req.valid("json"));
    return c.json({ data }, 201);
  });

  router.openapi(revokeRoute, async (c) => {
    await service.revoke(c.get("workspace"), c.get("userId"), c.req.valid("param").id);
    return c.body(null, 204);
  });

  return router;
}
