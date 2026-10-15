import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@/lib/context";
import { ForbiddenError } from "@/lib/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// CSRF stance for /admin (documented choice: custom header, not double-submit):
// SameSite=Lax already blocks the cookie on cross-site POSTs in modern
// browsers; requiring X-Requested-With on top means even a same-site form or a
// legacy browser can't forge a mutation, because cross-origin JavaScript
// cannot set custom headers without passing CORS preflight — and our CORS
// config only admits ADMIN_URL. Any non-empty value passes; the admin SPA
// sends "XMLHttpRequest".
export function adminCsrf(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && !c.req.header("x-requested-with")) {
      throw new ForbiddenError("Missing X-Requested-With header");
    }
    await next();
  };
}
