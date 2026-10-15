import { Scalar } from "@scalar/hono-api-reference";
import type { AdminAuthService } from "./admin/auth/admin-auth.service";
import { mountAdminRoutes } from "./admin/mount";
import type { AdminNotificationsService } from "./admin/notifications/admin-notifications.service";
import type { CrudService } from "./admin/registry/crud.service";
import type { AdminRegistry, AdminResourceDef } from "./admin/registry/registry";
import { resolveServices } from "./app.defaults";
import { applyGlobalMiddleware, type RateLimitOverrides } from "./app.middleware";
import { env } from "./config/env";
import type { CachedFn } from "./lib/cache";
import { errorHandler, notFoundHandler } from "./lib/error-handler";
import { createRouter } from "./lib/openapi";
import { type ModuleServices, mountModules } from "./modules";
import { createSystemRoutes, type ReadinessCheck } from "./modules/system/system.routes";

export type { ReadinessCheck };

// Partial<ModuleServices> provides one optional injection slot per public
// module (authService, usersService, ...) — tests inject mocks by key;
// production wiring comes from db + env via app.defaults.ts.
export interface CreateAppOptions extends Partial<ModuleServices> {
  // Phase 2 adds the DB ping here; Phase 5+ can add upstream checks.
  readinessChecks?: ReadinessCheck[];
  // E2e tests inject a service built on a mocked GoogleOAuth here.
  adminAuthService?: AdminAuthService;
  // Tests register their own defs; production uses the default registry
  // (admin/registry/resources.ts — the index over resources/*.resource.ts).
  adminRegistry?: AdminRegistry;
  // Unit tests inject fake per-resource services; production builds the
  // Drizzle-backed service for each registered def.
  crudServiceFactory?: (def: AdminResourceDef) => CrudService;
  // Tests inject a service built on fake repos/sender; production wiring
  // comes from app.defaults.ts.
  adminNotificationsService?: AdminNotificationsService;
  // Tests inject a passthrough; production uses the shared Redis-backed cache.
  metaCachedFn?: CachedFn;
  // Overridable in tests; production follows DOCS_ENABLED (disable in prod
  // or admin-gate once Phase 9 lands).
  docsEnabled?: boolean;
  // Overridable in tests (e2e suites fire more requests than the strict
  // production limits allow); production uses the middleware defaults.
  rateLimit?: RateLimitOverrides;
}

// The composition root, kept thin on purpose: defaults live in
// app.defaults.ts, the middleware chain in app.middleware.ts, module mounts
// in modules/index.ts, and admin mounts in admin/mount.ts. Adding a module
// touches those files — not this one.
export function createApp(options: CreateAppOptions = {}) {
  const { readinessChecks = [], docsEnabled = env.DOCS_ENABLED, rateLimit = {} } = options;
  const {
    modules,
    adminAuthService,
    adminRegistry,
    crudServiceFactory,
    adminNotificationsService,
  } = resolveServices(options);

  // env.API_BASE_PATH is "" when serving at the root (see config/env.ts), and
  // Hono's basePath needs "/" for that case. Everything registered below —
  // middleware matchers, route mounts, /openapi.json, /docs — lands under the
  // prefix, and @hono/zod-openapi folds it into the generated document paths.
  const app = createRouter().basePath(env.API_BASE_PATH || "/");

  applyGlobalMiddleware(app, { rateLimit });

  app.route("/", createSystemRoutes({ readinessChecks }));
  mountModules(app, modules);
  mountAdminRoutes(app, {
    adminAuthService,
    adminRegistry,
    crudServiceFactory,
    adminNotificationsService,
    ...(options.metaCachedFn && { metaCachedFn: options.metaCachedFn }),
  });

  if (docsEnabled) {
    // @hono/zod-openapi has no 3.2 generator (doc31 is its newest). OAS 3.2 is a
    // backward-compatible superset of 3.1, so the 3.1 generator's output is a
    // valid 3.2 document.
    app.doc31("/openapi.json", {
      openapi: "3.2.0",
      info: { title: "API Starter", version: "0.0.0" },
    });
    // The route itself is prefixed by basePath, but `url` is fetched by the
    // browser and must be the full public path.
    app.get("/docs", Scalar({ url: `${env.API_BASE_PATH}/openapi.json` }));
  }

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return app;
}

export type App = ReturnType<typeof createApp>;
