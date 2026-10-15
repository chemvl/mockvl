import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@/lib/context";
import { logger } from "@/lib/logger";

export function requestLogger(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const startedAt = performance.now();
    const base = () => ({
      method: c.req.method,
      path: c.req.path,
      durationMs: Math.round(performance.now() - startedAt),
      requestId: c.get("requestId"),
    });

    try {
      await next();
    } catch (err) {
      // The final status is decided by app.onError after this middleware
      // unwinds, so it cannot be logged here; correlate via requestId.
      logger.info(base(), "request errored");
      throw err;
    }

    logger.info({ ...base(), status: c.res.status }, "request completed");
  };
}
