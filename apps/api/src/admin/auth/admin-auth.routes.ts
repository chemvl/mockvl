import { createRoute, z } from "@hono/zod-openapi";
import { AdminUserSchema, envelope } from "@starter/schemas";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { env } from "@/config/env";
import { UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createRouter, errorResponse, jsonContent } from "@/lib/openapi";
import { serializeAdminUser } from "@/lib/serialize";
import type { RequireAdmin } from "@/middleware/admin-auth";
import type { AdminAuthService } from "./admin-auth.service";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  OAUTH_STATE_COOKIE,
  OAUTH_TEMP_COOKIE_PATH,
  OAUTH_VERIFIER_COOKIE,
  oauthTempCookieOptions,
} from "./admin-cookies";

const googleRoute = createRoute({
  method: "get",
  path: "/google",
  tags: ["admin-auth"],
  summary: "Start Google sign-in for admins",
  responses: {
    302: { description: "Redirect to the Google consent screen (hd pre-selected)" },
  },
});

const callbackRoute = createRoute({
  method: "get",
  path: "/google/callback",
  tags: ["admin-auth"],
  summary: "Google OAuth callback",
  // Everything optional: any malformed callback becomes a redirect with a
  // generic error param, never a JSON validation error mid browser flow.
  request: { query: z.object({ code: z.string().optional(), state: z.string().optional() }) },
  responses: {
    302: {
      description: "Redirect to ADMIN_URL — with ?error=admin_login_failed on any failure",
    },
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["admin-auth"],
  summary: "Current admin user",
  security: [{ adminSession: [] }],
  responses: {
    200: jsonContent(envelope(AdminUserSchema), "The signed-in admin"),
    401: errorResponse("No valid admin session"),
  },
});

// Deliberately NOT behind requireAdmin (and not annotated with the
// adminSession security scheme): logout with a missing or dead cookie is a
// harmless no-op 200 — there is nothing to learn from it.
const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  tags: ["admin-auth"],
  summary: "End the admin session",
  responses: {
    200: jsonContent(
      envelope(z.object({ success: z.literal(true) })),
      "Session deleted (idempotent)",
    ),
    403: errorResponse("Missing X-Requested-With header"),
  },
});

export interface AdminAuthRoutesDeps {
  service: AdminAuthService;
  requireAdmin: RequireAdmin;
}

// HTTP layer only: cookies, redirects, envelopes. All decisions live in the service.
export function createAdminAuthRoutes({ service, requireAdmin }: AdminAuthRoutesDeps) {
  const router = createRouter();

  router.openapi(googleRoute, (c) => {
    const request = service.startGoogleLogin();
    setCookie(c, OAUTH_STATE_COOKIE, request.state, oauthTempCookieOptions());
    setCookie(c, OAUTH_VERIFIER_COOKIE, request.codeVerifier, oauthTempCookieOptions());
    return c.redirect(request.url.toString(), 302);
  });

  router.openapi(callbackRoute, async (c) => {
    const { code, state } = c.req.valid("query");
    const cookieState = getCookie(c, OAUTH_STATE_COOKIE);
    const codeVerifier = getCookie(c, OAUTH_VERIFIER_COOKIE);
    // Burn the temp cookies either way: the state is single-use.
    deleteCookie(c, OAUTH_STATE_COOKIE, { path: OAUTH_TEMP_COOKIE_PATH });
    deleteCookie(c, OAUTH_VERIFIER_COOKIE, { path: OAUTH_TEMP_COOKIE_PATH });

    // Browser-facing failure mode is a redirect with a generic marker — the
    // admin SPA shows "sign-in failed"; specifics only ever go to the log.
    const failure = () => c.redirect(`${env.ADMIN_URL}?error=admin_login_failed`, 302);

    if (!code || !state || !cookieState || !codeVerifier || state !== cookieState) {
      logger.warn(
        {
          requestId: c.get("requestId"),
          hasCode: Boolean(code),
          stateMatches: state === cookieState,
        },
        "admin login rejected: callback state validation failed",
      );
      return failure();
    }

    try {
      const login = await service.handleGoogleCallback(code, codeVerifier);
      setCookie(
        c,
        ADMIN_SESSION_COOKIE,
        login.sessionToken,
        adminSessionCookieOptions(login.expiresAt),
      );
      return c.redirect(env.ADMIN_URL, 302);
    } catch (err) {
      // The service already logged why; anything non-auth is a real 500.
      if (err instanceof UnauthorizedError) return failure();
      throw err;
    }
  });

  router.use(meRoute.path, requireAdmin());
  router.openapi(meRoute, (c) => {
    return c.json({ data: serializeAdminUser(c.get("adminUser")) }, 200);
  });

  router.openapi(logoutRoute, async (c) => {
    const sessionToken = getCookie(c, ADMIN_SESSION_COOKIE);
    if (sessionToken) {
      await service.logout(sessionToken);
    }
    deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/" });
    return c.json({ data: { success: true as const } }, 200);
  });

  return router;
}
