import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@/lib/context";

// Accept caller-supplied ids only if they look like a sane trace id;
// anything else is replaced so we never echo junk back in headers/logs.
const REQUEST_ID_PATTERN = /^[\w-]{1,128}$/;

export function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const id = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();

    c.set("requestId", id);
    c.header("X-Request-Id", id);
    await next();
  };
}
