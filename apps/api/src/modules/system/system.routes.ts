import { createRoute, z } from "@hono/zod-openapi";
import { envelope } from "@starter/schemas";
import { logger } from "@/lib/logger";
import { createRouter, errorResponse, jsonContent } from "@/lib/openapi";

export interface ReadinessCheck {
  name: string;
  check: () => void | Promise<void>;
}

export interface CreateSystemRoutesDeps {
  // Phase 2 adds the DB ping here; Phase 5+ can add upstream checks.
  readinessChecks: ReadinessCheck[];
}

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  summary: "Liveness probe",
  responses: {
    200: jsonContent(envelope(z.object({ status: z.literal("ok") })), "Process is alive"),
  },
});

const readyRoute = createRoute({
  method: "get",
  path: "/ready",
  tags: ["system"],
  summary: "Readiness probe",
  responses: {
    200: jsonContent(envelope(z.object({ status: z.literal("ready") })), "All checks passed"),
    503: errorResponse("One or more readiness checks failed"),
  },
});

export function createSystemRoutes({ readinessChecks }: CreateSystemRoutesDeps) {
  const router = createRouter();

  router.openapi(healthRoute, (c) => c.json({ data: { status: "ok" as const } }, 200));

  router.openapi(readyRoute, async (c) => {
    const results = await Promise.allSettled(
      readinessChecks.map(({ check }) => Promise.resolve().then(check)),
    );
    const failures = results.flatMap((result, index) => {
      if (result.status !== "rejected") return [];
      return [
        {
          name: readinessChecks[index]?.name ?? "unknown",
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        },
      ];
    });

    if (failures.length > 0) {
      // Failure reasons are logged for operators but never returned to callers.
      logger.warn({ failures, requestId: c.get("requestId") }, "readiness check failed");
      return c.json(
        {
          error: {
            code: "NOT_READY",
            message: "Service is not ready",
            details: failures.map(({ name }) => ({ name })),
            requestId: c.get("requestId"),
          },
        },
        503,
      );
    }

    return c.json({ data: { status: "ready" as const } }, 200);
  });

  return router;
}
