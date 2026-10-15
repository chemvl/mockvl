import { sha256Hex } from "./import/summarize";

// Runtime route cache key (spec: cache:mocks:route:{ws}/{slug}). Both parts
// are validated against SLUG_PATTERN before they reach a key, so a `*` can
// never turn an exact invalidate() into a pattern sweep (lib/cache.ts).
export function mockRouteCacheKey(wsSlug: string, mockSlug: string): string {
  return `cache:mocks:route:${wsSlug}/${mockSlug}`;
}

// Every runtime route of one workspace — a deliberate pattern sweep, used
// when the workspace slug changes or the workspace is deleted.
export function workspaceRouteCachePattern(wsSlug: string): string {
  return mockRouteCacheKey(wsSlug, "*");
}

// Runtime override lookup (overrides spec: cache:mocks:override:{mockId}:{sha256(method path code)}).
// The hash keeps the template's `{`, `}` — and any `*` — out of the key, so
// invalidate() always treats it as an exact key, never a pattern.
export function mockOverrideCacheKey(
  mockId: string,
  key: { method: string; path: string; code: number },
): string {
  return `cache:mocks:override:${mockId}:${sha256Hex(`${key.method} ${key.path} ${key.code}`)}`;
}
