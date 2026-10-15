import {
  type AuthInfo,
  createMcpHandler,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import { ForbiddenError } from "@/lib/errors";
import { createRouter } from "@/lib/openapi";
import type {
  McpPrincipal,
  PersonalAccessTokensService,
} from "@/modules/personal-access-tokens/personal-access-tokens.service";
import { createMockyardMcpServer, type McpCaller, type McpMocksService } from "./mcp.tools";

export interface McpRoutesDeps {
  personalAccessTokensService: Pick<PersonalAccessTokensService, "authenticate">;
  mocksService: McpMocksService;
}

// Fail closed: the factory must never build a server for an unverified caller.
function callerFrom(authInfo: AuthInfo | undefined): McpCaller {
  // Set only by verifyAccessToken below; AuthInfo.extra is untyped by the SDK.
  const principal = authInfo?.extra?.principal as McpPrincipal | undefined;
  const requestId = authInfo?.extra?.requestId;
  if (!principal || typeof requestId !== "string") {
    throw new Error("MCP request without a verified principal");
  }
  return { ...principal, requestId };
}

// Stateless Streamable HTTP MCP endpoint, authenticated by personal access
// tokens only (JWTs get 401 here, PATs get 401 everywhere else). Plain
// router.all, not router.openapi: MCP stays out of the OpenAPI document.
export function createMcpRoutes(deps: McpRoutesDeps) {
  const gate = requireBearerAuth({
    verifier: {
      async verifyAccessToken(token) {
        const principal = await deps.personalAccessTokensService.authenticate(token);
        if (!principal) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid, expired, or revoked token");
        }
        return {
          token,
          clientId: principal.tokenId,
          scopes:
            principal.scope === "mocks:write" ? ["mocks:read", "mocks:write"] : ["mocks:read"],
          expiresAt: Math.floor(principal.expiresAt.getTime() / 1000),
          extra: { principal },
        };
      },
    },
    requiredScopes: ["mocks:read"],
  });
  // Default response mode: plain JSON, since these tools emit no notifications
  // (`responseMode: "json"` would only add an SDK startup warning).
  const handler = createMcpHandler(({ authInfo }) =>
    createMockyardMcpServer(callerFrom(authInfo), deps.mocksService),
  );

  const router = createRouter();
  router.all("/", async (c) => {
    // Agents are non-browser clients; any Origin means a browser page is calling.
    if (c.req.header("origin") !== undefined) {
      throw new ForbiddenError("Browser requests can't call the MCP endpoint");
    }
    const auth = await gate(c.req.raw);
    if (auth instanceof Response) return auth;
    return handler.fetch(c.req.raw, {
      authInfo: { ...auth, extra: { ...auth.extra, requestId: c.get("requestId") } },
    });
  });
  return router;
}
