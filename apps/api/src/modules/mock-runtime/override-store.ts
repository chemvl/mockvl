import type { CachedFn } from "@/lib/cache";
import { mockOverrideCacheKey } from "@/modules/mocks/mocks.cache";
import { MOCK_OVERRIDE_CACHE_TTL_S } from "@/modules/mocks/mocks.constants";
import type { OverrideKey, OverridesRepo } from "@/modules/mocks/overrides.repo";

export interface OverrideStore {
  // The saved body for one endpoint + code of a mock, or null.
  get(mockId: string, key: OverrideKey): Promise<string | null>;
}

export interface OverrideStoreDeps {
  repo: Pick<OverridesRepo, "findBody">;
  // lib/cache's cached(): Redis cache-aside, DB fallback when Redis is down.
  // Misses (null) are cached too, so an endpoint without an override costs
  // one Redis read per request. Save/reset invalidate the key
  // (mocks.service.ts); other pods may serve the previous body for up to the
  // ~200 ms L1 linger.
  cached: CachedFn;
  ttlS?: number;
}

export function createOverrideStore(deps: OverrideStoreDeps): OverrideStore {
  const { repo, cached, ttlS = MOCK_OVERRIDE_CACHE_TTL_S } = deps;
  return {
    get(mockId, key) {
      return cached(mockOverrideCacheKey(mockId, key), ttlS, () => repo.findBody(mockId, key));
    },
  };
}
