import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import { env } from "@/config/env";
import type { AppEnv } from "@/lib/context";
import { UnauthorizedError } from "@/lib/errors";

const BEARER_PREFIX = "Bearer ";

// Verifies the access token and exposes its subject as `c.get("userId")`.
// Every failure mode maps to the same 401 so callers learn nothing about why.
export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError("Missing bearer token");
    }
    const token = header.slice(BEARER_PREFIX.length);

    let payload: Awaited<ReturnType<typeof verify>>;
    try {
      payload = await verify(token, env.JWT_SECRET, "HS256");
    } catch {
      throw new UnauthorizedError("Invalid or expired token");
    }

    if (payload.type !== "access" || typeof payload.sub !== "string") {
      throw new UnauthorizedError("Invalid or expired token");
    }

    c.set("userId", payload.sub);
    await next();
  };
}
