import { createRoute, z } from "@hono/zod-openapi";
import { envelope, ResourceMetaSchema } from "@starter/schemas";
import { roleAtLeast } from "@/admin/auth/roles";
import type { AdminRegistry } from "@/admin/registry/registry";
import { env } from "@/config/env";
import { type CachedFn, cached as defaultCached } from "@/lib/cache";
import { createRouter, errorResponse, jsonContent } from "@/lib/openapi";
import type { RequireAdmin } from "@/middleware/admin-auth";

// GET /admin/meta/resources — the registry serialized for the frontend
// (PLAN 9b): Refine builds the sidebar, list pages, and forms from this.
// Filtered to what the caller's role can at least list; each entry is the
// def's public half only (never Drizzle internals).
//
// This is the 8.5c worked example deferred to Phase 9: the payload is
// per-role and static at runtime (the registry only changes at deploy), so
// it is served through cached() keyed by role and invalidated at boot.

export const META_RESOURCES_CACHE_PREFIX = "cache:admin:meta:resources:";

export interface CreateMetaRoutesDeps {
  registry: AdminRegistry;
  requireAdmin: RequireAdmin;
  // Tests inject a passthrough so they never touch the shared Redis client.
  cachedFn?: CachedFn;
  cacheTtlS?: number;
}

export function createMetaRoutes({
  registry,
  requireAdmin,
  cachedFn = defaultCached,
  cacheTtlS = env.CACHE_DEFAULT_TTL_S,
}: CreateMetaRoutesDeps) {
  const router = createRouter();

  router.openapi(
    createRoute({
      method: "get",
      path: "/resources",
      tags: ["admin/meta"],
      summary: "List admin resources the caller can access",
      security: [{ adminSession: [] }],
      middleware: [requireAdmin("viewer")] as const,
      responses: {
        200: jsonContent(
          envelope(z.array(ResourceMetaSchema)),
          "Registry entries the caller's role can at least list",
        ),
        401: errorResponse("Admin session required"),
      },
    }),
    async (c) => {
      const role = c.get("adminUser").role;
      const data = await cachedFn(`${META_RESOURCES_CACHE_PREFIX}${role}`, cacheTtlS, async () =>
        registry
          .list()
          .filter((def) => roleAtLeast(role, def.permissions.list))
          .map((def) => registry.toMeta(def)),
      );
      return c.json({ data }, 200);
    },
  );

  return router;
}
