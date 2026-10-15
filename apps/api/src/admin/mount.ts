import { createAdminAuthRoutes } from "@/admin/auth/admin-auth.routes";
import type { AdminAuthService } from "@/admin/auth/admin-auth.service";
import { createMetaRoutes } from "@/admin/meta.routes";
import { createAdminNotificationsRoutes } from "@/admin/notifications/admin-notifications.routes";
import type { AdminNotificationsService } from "@/admin/notifications/admin-notifications.service";
import { createCrudRoutes } from "@/admin/registry/crud.routes";
import type { CrudService } from "@/admin/registry/crud.service";
import type { AdminRegistry, AdminResourceDef } from "@/admin/registry/registry";
import type { CachedFn } from "@/lib/cache";
import type { AppOpenAPI } from "@/lib/openapi";
import { createRequireAdmin } from "@/middleware/admin-auth";

export interface AdminMountDeps {
  adminAuthService: AdminAuthService;
  adminRegistry: AdminRegistry;
  crudServiceFactory: (def: AdminResourceDef) => CrudService;
  adminNotificationsService: AdminNotificationsService;
  // Tests inject a passthrough; production uses the shared Redis-backed cache.
  metaCachedFn?: CachedFn;
}

// Mounts everything under /admin: auth, meta, and the generic CRUD routes.
export function mountAdminRoutes(app: AppOpenAPI, deps: AdminMountDeps): void {
  const {
    adminAuthService,
    adminRegistry,
    crudServiceFactory,
    adminNotificationsService,
    metaCachedFn,
  } = deps;

  // Referenced by admin routes (e.g. GET /admin/auth/me).
  app.openAPIRegistry.registerComponent("securitySchemes", "adminSession", {
    type: "apiKey",
    in: "cookie",
    name: "admin_session",
  });

  const requireAdmin = createRequireAdmin(adminAuthService);
  app.route(
    "/admin/auth",
    createAdminAuthRoutes({
      service: adminAuthService,
      requireAdmin,
    }),
  );
  app.route(
    "/admin/meta",
    createMetaRoutes({
      registry: adminRegistry,
      requireAdmin,
      ...(metaCachedFn && { cachedFn: metaCachedFn }),
    }),
  );
  // Custom console routes — not a registry resource (the notifications
  // console has actions and stats the generic CRUD shape can't express).
  // "notifications" is a reserved registry name so a def cannot shadow this.
  app.route(
    "/admin/notifications",
    createAdminNotificationsRoutes({ service: adminNotificationsService, requireAdmin }),
  );
  // Generic CRUD for every registered resource (PLAN 9b). The registry
  // reserves the names "auth", "meta", and "notifications", so these mounts
  // cannot collide.
  for (const def of adminRegistry.list()) {
    app.route(
      `/admin/${def.name}`,
      createCrudRoutes({ def, service: crudServiceFactory(def), requireAdmin }),
    );
  }
}
