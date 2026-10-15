import type { AdminRole } from "@starter/schemas";
import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AdminAuthService } from "@/admin/auth/admin-auth.service";
import { ADMIN_SESSION_COOKIE, adminSessionCookieOptions } from "@/admin/auth/admin-cookies";
import { roleAtLeast } from "@/admin/auth/roles";
import type { AppEnv } from "@/lib/context";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

export { ADMIN_SESSION_COOKIE };

// Factory taking the service (same lightweight-DI pattern as the routes):
// `const requireAdmin = createRequireAdmin(service)` once at assembly time,
// then `requireAdmin("editor")` per route. Role ordering: viewer < editor < owner.
export function createRequireAdmin(adminAuthService: AdminAuthService) {
  return function requireAdmin(minRole: AdminRole = "viewer"): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
      const sessionToken = getCookie(c, ADMIN_SESSION_COOKIE);
      if (!sessionToken) {
        throw new UnauthorizedError("Admin session required");
      }

      const session = await adminAuthService.validateSession(sessionToken);
      if (!session) {
        // Dead cookie — clear it so the browser stops resending it.
        deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/" });
        throw new UnauthorizedError("Admin session required");
      }

      if (!roleAtLeast(session.adminUser.role, minRole)) {
        throw new ForbiddenError(`Requires ${minRole} role`);
      }

      if (session.renewed) {
        // Sliding expiry moved — keep the cookie's lifetime in step with the DB.
        setCookie(
          c,
          ADMIN_SESSION_COOKIE,
          sessionToken,
          adminSessionCookieOptions(session.expiresAt),
        );
      }

      c.set("adminUser", session.adminUser);
      await next();
    };
  };
}

export type RequireAdmin = ReturnType<typeof createRequireAdmin>;
