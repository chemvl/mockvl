// Mockyard limits.
export const MAX_SCHEMA_BYTES = 5 * 1024 * 1024;
export const MAX_OPERATIONS = 1000;
export const MAX_MOCKS_PER_WORKSPACE = 50;
// Newest N versions are kept; older ones are deleted after each insert.
export const MAX_VERSIONS_PER_MOCK = 20;
// JSON body limit for the schema routes (5 MiB of schema + JSON escaping
// headroom); the global 1 MiB limit skips them (app.middleware.ts).
export const SCHEMA_ROUTE_BODY_LIMIT_BYTES = 6 * 1024 * 1024;
export const SCHEMA_URL_TIMEOUT_MS = 10_000;
export const SCHEMA_URL_MAX_REDIRECTS = 3;
export const MOCK_ROUTE_CACHE_TTL_S = 60;
// Saved response body limit (overrides spec § Data model), in UTF-8 bytes.
export const MAX_OVERRIDE_BODY_BYTES = 256 * 1024;
export const MOCK_OVERRIDE_CACHE_TTL_S = 60;
// mock_versions.source_label for generated custom-mock versions.
export const CUSTOM_SOURCE_LABEL = "Custom endpoints";
