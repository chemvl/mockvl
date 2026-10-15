import { isValidSlug } from "@starter/schemas";
import type { CachedFn } from "@/lib/cache";
import { mockRouteCacheKey } from "@/modules/mocks/mocks.cache";
import { MOCK_ROUTE_CACHE_TTL_S } from "@/modules/mocks/mocks.constants";
import type { MockRouteRecord, MocksRepo } from "@/modules/mocks/mocks.repo";

export type MockRoute = MockRouteRecord;

export interface RouteResolver {
  resolve(wsSlug: string, mockSlug: string): Promise<MockRoute | null>;
}

export interface RouteResolverDeps {
  mocksRepo: Pick<MocksRepo, "findRoute">;
  // lib/cache's cached(): Redis cache-aside that degrades to the DB when
  // Redis is down. Misses (null) are cached too; every management mutation
  // invalidates the affected keys (mocks.service.ts).
  cached: CachedFn;
  ttlS?: number;
}

export function createRouteResolver(deps: RouteResolverDeps): RouteResolver {
  const { mocksRepo, cached, ttlS = MOCK_ROUTE_CACHE_TTL_S } = deps;
  return {
    resolve(wsSlug: string, mockSlug: string): Promise<MockRoute | null> {
      // Anything that is not a slug can't be published — and must never be
      // embedded in a cache key (a `*` would make invalidate() a pattern).
      if (!isValidSlug(wsSlug) || !isValidSlug(mockSlug)) return Promise.resolve(null);
      return cached(mockRouteCacheKey(wsSlug, mockSlug), ttlS, () =>
        mocksRepo.findRoute(wsSlug, mockSlug),
      );
    },
  };
}
