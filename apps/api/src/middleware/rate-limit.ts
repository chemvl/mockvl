import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import { rateLimiter, type Store } from "hono-rate-limiter";
import type { AppEnv } from "@/lib/context";
import { RateLimitError } from "@/lib/errors";

export interface RateLimitSettings {
  windowMs: number;
  limit: number;
  // Adapter seam: the default store is in-memory and therefore PER PROCESS —
  // each instance enforces its own count, so the effective limit is
  // limit × instances. Tests rely on that isolation; production wiring
  // (index.ts) passes the shared Redis store from rate-limit-redis-store.ts.
  store?: Store<AppEnv>;
  // Exact paths this limiter ignores entirely (not counted, never 429).
  skipPaths?: readonly string[];
  // Whether a trusted reverse proxy fronts the API (env.TRUST_PROXY in
  // production wiring). Controls which source the per-client key trusts —
  // see clientKey below. Defaults to false: forwarded headers are ignored.
  trustProxy?: boolean;
  // Overrides the per-client key (default: clientIp). The mock tier keys on
  // client IP + mock so one hammered mock cannot starve the caller's others.
  keyGenerator?: (c: Context<AppEnv>) => string;
}

// Sane global ceiling per client; individual route groups tighten below it.
export const GLOBAL_RATE_LIMIT: RateLimitSettings = { windowMs: 60_000, limit: 100 };
// Strict on credential endpoints: sign-in and token refresh are guess targets.
export const AUTH_RATE_LIMIT: RateLimitSettings = { windowMs: 60_000, limit: 10 };

function socketAddress(c: Context<AppEnv>): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No Bun server in scope (e.g. app.request() in tests).
    return "unknown";
  }
}

// Client IP derivation, used as the rate-limit key — exported so there is
// exactly ONE x-forwarded-for parser encoding the trust-proxy reasoning.
// Which source to believe depends on deployment:
// - trustProxy: a trusted reverse proxy fronts the API. x-real-ip (set by
//   e.g. nginx ingress from the real peer) wins; otherwise the RIGHTMOST
//   x-forwarded-for hop — the one appended by our own proxy. Earlier hops are
//   whatever the client sent and can be forged to rotate keys.
// - otherwise: forwarded headers are client-controlled (trivial limit
//   bypass), so only the socket address counts.
export function clientIp(c: Context<AppEnv>, trustProxy: boolean): string {
  if (trustProxy) {
    const realIp = c.req.header("x-real-ip")?.trim();
    if (realIp) return realIp;
    const nearestHop = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (nearestHop) return nearestHop;
  }
  return socketAddress(c);
}

export function createRateLimiter(settings: RateLimitSettings): MiddlewareHandler<AppEnv> {
  return rateLimiter<AppEnv>({
    windowMs: settings.windowMs,
    limit: settings.limit,
    standardHeaders: "draft-6",
    keyGenerator:
      settings.keyGenerator ?? ((c: Context<AppEnv>) => clientIp(c, settings.trustProxy ?? false)),
    ...(settings.store && { store: settings.store }),
    ...(settings.skipPaths && {
      skip: (c: Context<AppEnv>) => settings.skipPaths?.includes(c.req.path) ?? false,
    }),
    // Thrown (not returned) so the global onError renders the standard
    // envelope; RateLimit-*/Retry-After headers are already set by then.
    handler: () => {
      throw new RateLimitError();
    },
  });
}
