import { createRoute, z } from "@hono/zod-openapi";
import { envelope, UsageRangeSchema, UsageReportSchema } from "@starter/schemas";
import { createRouter, errorResponse, jsonContent } from "@/lib/openapi";
import { authMiddleware } from "@/middleware/auth";
import type { RequireWorkspaceMember } from "@/middleware/require-workspace-member";
import type { UsageService } from "./usage.service";

const WsParamsSchema = z.object({
  ws: z.string().openapi({ param: { name: "ws", in: "path" }, example: "jane" }),
});

export function createUsageRoutes(
  service: UsageService,
  requireWorkspaceMember: RequireWorkspaceMember,
) {
  const usageRoute = createRoute({
    method: "get",
    path: "/{ws}/usage",
    operationId: "getWorkspaceUsage",
    tags: ["usage"],
    summary: "Request counts for the workspace's mocks",
    description: "UTC days ending today; counters lag by at most one minute.",
    security: [{ bearerAuth: [] }],
    middleware: [authMiddleware(), requireWorkspaceMember] as const,
    request: { params: WsParamsSchema, query: z.object({ range: UsageRangeSchema.default("7d") }) },
    responses: {
      200: jsonContent(envelope(UsageReportSchema), "Usage report"),
      400: errorResponse("Invalid range"),
      401: errorResponse("Missing, invalid, or expired access token"),
      403: errorResponse("Account outside APP_GOOGLE_ALLOWED_HD (DOMAIN_NOT_ALLOWED)"),
      404: errorResponse("Workspace not found (or not a member)"),
    },
  });

  const router = createRouter();
  router.openapi(usageRoute, async (c) => {
    const data = await service.report(c.get("workspace"), c.req.valid("query").range);
    return c.json({ data }, 200);
  });
  return router;
}
