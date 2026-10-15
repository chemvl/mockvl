import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { env } from "@/config/env";
import { AppError } from "@/lib/errors";
import type { AppOpenAPI } from "@/lib/openapi";
import { adminCsrf } from "@/middleware/admin-csrf";
import { jsonOnly } from "@/middleware/json-only";
import {
  AUTH_RATE_LIMIT,
  createRateLimiter,
  GLOBAL_RATE_LIMIT,
  type RateLimitSettings,
} from "@/middleware/rate-limit";
import { requestId } from "@/middleware/request-id";
import { requestLogger } from "@/middleware/request-logger";
import { SCHEMA_ROUTE_BODY_LIMIT_BYTES } from "@/modules/mocks/mocks.constants";

export interface RateLimitOverrides {
  global?: RateLimitSettings;
  auth?: RateLimitSettings;
}

// JSON API payloads should be far smaller; raise per-route if a real need
// (e.g. bulk import) ever lands.
const BODY_LIMIT_BYTES = 1024 * 1024;

// The Mockyard schema routes carry a whole OpenAPI/Postman document (≤ 5 MiB)
// inside JSON; they get SCHEMA_ROUTE_BODY_LIMIT_BYTES and the global limit
// skips them. Matched on the full path because this runs before routing.
const SCHEMA_ROUTE_PATTERN =
  /\/workspaces\/[^/]+\/(?:schema\/inspect|mocks|mocks\/[^/]+\/versions)$/;

export function isSchemaRoute(method: string, path: string): boolean {
  return (
    method === "POST" &&
    path.startsWith(`${env.API_BASE_PATH}/workspaces/`) &&
    SCHEMA_ROUTE_PATTERN.test(path)
  );
}

function payloadTooLarge(): never {
  throw new AppError("PAYLOAD_TOO_LARGE", 413, "Request body too large");
}

// The global chain, applied before any route mounts. Lives here (not in
// middleware/, which holds the reusable factories) because it configures
// this one app. Order matters — see the comments on each entry.
export function applyGlobalMiddleware(
  app: AppOpenAPI,
  { rateLimit = {} }: { rateLimit?: RateLimitOverrides } = {},
): void {
  app.use(requestId());
  app.use(requestLogger());
  app.use(secureHeaders());
  // Explicit origins with credentials — never wildcard: browsers reject
  // `*` + credentials, and reflecting arbitrary origins would let any site
  // ride the admin cookie. Normalized to origin so a path or trailing slash
  // in ADMIN_URL can't break the exact-match against the Origin header.
  app.use(
    cors({
      origin: [new URL(env.ADMIN_URL).origin],
      credentials: true,
      exposeHeaders: ["X-Request-Id"],
    }),
  );
  // Probes are exempt: behind a NAT/ingress they share the per-IP budget with
  // real traffic, and a 429 on /ready reads as "unhealthy" to an orchestrator.
  app.use(
    createRateLimiter({
      // skipPaths matches against c.req.path, which carries the base path.
      skipPaths: [`${env.API_BASE_PATH}/health`, `${env.API_BASE_PATH}/ready`],
      ...(rateLimit.global ?? GLOBAL_RATE_LIMIT),
    }),
  );
  app.use("/auth/*", createRateLimiter(rateLimit.auth ?? AUTH_RATE_LIMIT));
  // Admin sign-in shares the strict auth tier. In production (index.ts) both
  // middlewares receive the same Redis store instance, so an IP hammering
  // /auth and /admin/auth draws from one budget — intended for a strict tier.
  // /me is exempt: it is a cookie read, not a guess target, and the admin
  // shell calls it on every navigation (authProvider.check + route loaders) —
  // under the strict tier a few clicks locked the admin out. The global
  // limiter above still bounds it.
  app.use(
    "/admin/auth/*",
    createRateLimiter({
      ...(rateLimit.auth ?? AUTH_RATE_LIMIT),
      skipPaths: [`${env.API_BASE_PATH}/admin/auth/me`],
    }),
  );
  // CSRF stance (SameSite=Lax + custom header) documented in middleware/admin-csrf.ts.
  app.use("/admin/*", adminCsrf());
  // Content-type check before the size check: on chunked requests bodyLimit
  // buffers up to maxSize, so let the cheap header rejection go first.
  app.use(jsonOnly());
  const defaultBodyLimit = bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: payloadTooLarge });
  const schemaBodyLimit = bodyLimit({
    maxSize: SCHEMA_ROUTE_BODY_LIMIT_BYTES,
    onError: payloadTooLarge,
  });
  app.use((c, next) =>
    isSchemaRoute(c.req.method, c.req.path) ? schemaBodyLimit(c, next) : defaultBodyLimit(c, next),
  );
}
