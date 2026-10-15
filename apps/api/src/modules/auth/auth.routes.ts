import { createRoute, z } from "@hono/zod-openapi";
import {
  AuthSessionSchema,
  envelope,
  GoogleCodeLoginSchema,
  GoogleLoginSchema,
  LogoutResultSchema,
  LogoutSchema,
  RefreshSchema,
  TokenPairSchema,
} from "@starter/schemas";
import { ForbiddenError } from "@/lib/errors";
import { createRouter, errorResponse, jsonBody, jsonContent } from "@/lib/openapi";
import { serializeUser } from "@/lib/serialize";
import type { AuthResult, AuthService } from "./auth.service";

function serializeSession(result: AuthResult) {
  return {
    user: serializeUser(result.user),
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  };
}

const googleLoginRoute = createRoute({
  method: "post",
  path: "/google",
  operationId: "loginWithGoogle",
  tags: ["auth"],
  summary: "Log in or register with a Google ID token",
  description:
    "Verifies a client-obtained Google ID token; matches by Google account, " +
    "auto-links by verified email, or creates a password-less account.",
  request: jsonBody(GoogleLoginSchema),
  responses: {
    200: jsonContent(envelope(AuthSessionSchema), "Google identity accepted; tokens issued"),
    400: errorResponse("Invalid request body"),
    401: errorResponse("Invalid Google token or unverified email"),
    403: errorResponse("Account outside APP_GOOGLE_ALLOWED_HD (DOMAIN_NOT_ALLOWED)"),
  },
});

const googleCodeLoginRoute = createRoute({
  method: "post",
  path: "/google/code",
  operationId: "loginWithGoogleCode",
  tags: ["auth"],
  summary: "Log in or register with a Google authorization code",
  description:
    "Redeems a Google Identity Services popup code server-side (redirect_uri=postmessage), " +
    "then signs in exactly like POST /auth/google. Requires `X-Requested-With: XMLHttpRequest` " +
    "(CSRF mitigation per Google's popup-code guidance).",
  request: {
    // Optional in the schema so a missing header is a 403 from the handler,
    // matching adminCsrf, rather than a 400 validation error.
    headers: z.object({ "x-requested-with": z.string().optional() }),
    ...jsonBody(GoogleCodeLoginSchema),
  },
  responses: {
    200: jsonContent(envelope(AuthSessionSchema), "Google identity accepted; tokens issued"),
    400: errorResponse("Invalid request body"),
    401: errorResponse("Code exchange failed (GOOGLE_CODE_INVALID) or invalid Google token"),
    403: errorResponse(
      "Missing X-Requested-With header, or account outside APP_GOOGLE_ALLOWED_HD (DOMAIN_NOT_ALLOWED)",
    ),
  },
});

const refreshRoute = createRoute({
  method: "post",
  path: "/refresh",
  operationId: "refreshTokens",
  tags: ["auth"],
  summary: "Rotate a refresh token for a new token pair",
  request: jsonBody(RefreshSchema),
  responses: {
    200: jsonContent(envelope(TokenPairSchema), "New token pair; the old refresh token is dead"),
    400: errorResponse("Invalid request body"),
    401: errorResponse("Invalid, expired, or reused refresh token"),
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  operationId: "logout",
  tags: ["auth"],
  summary: "Revoke a refresh token family",
  request: jsonBody(LogoutSchema),
  responses: {
    200: jsonContent(envelope(LogoutResultSchema), "Session revoked (idempotent)"),
    400: errorResponse("Invalid request body"),
  },
});

// HTTP layer only: validate, call the service, wrap in the envelope.
export function createAuthRoutes(service: AuthService) {
  const router = createRouter();

  router.openapi(googleLoginRoute, async (c) => {
    const result = await service.loginWithGoogle(c.req.valid("json").idToken);
    return c.json({ data: serializeSession(result) }, 200);
  });

  router.openapi(googleCodeLoginRoute, async (c) => {
    if (c.req.valid("header")["x-requested-with"] !== "XMLHttpRequest") {
      throw new ForbiddenError("Missing X-Requested-With header");
    }
    const result = await service.loginWithGoogleCode(c.req.valid("json").code);
    return c.json({ data: serializeSession(result) }, 200);
  });

  router.openapi(refreshRoute, async (c) => {
    const result = await service.refresh(c.req.valid("json").refreshToken);
    return c.json({ data: result }, 200);
  });

  router.openapi(logoutRoute, async (c) => {
    await service.logout(c.req.valid("json").refreshToken);
    return c.json({ data: { success: true as const } }, 200);
  });

  return router;
}
