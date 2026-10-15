// Test env defaults. Imported FIRST in every test file so process.env is
// populated before src/config/env.ts parses it at import time.

// Force-assigned, not ??=: `bun test` from the repo root auto-loads the root
// .env, and its dev DATABASE_URL must never leak into tests. Tests always run
// against a separate test database (created + migrated by helpers/test-db.ts);
// point TEST_DATABASE_URL elsewhere to override (CI does).
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/app_test";
// Same leak guard: tests run single-database — reads must never hit a replica
// from the root .env while writes go to the test database.
delete process.env.DATABASE_REPLICA_URL;
process.env.JWT_SECRET ??= "test-jwt-secret-test-jwt-secret-test";
process.env.JWT_ACCESS_TTL ??= "15m";
process.env.JWT_REFRESH_TTL ??= "30d";
process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
process.env.GOOGLE_ALLOWED_HD ??= "example.com";
process.env.ADMIN_SESSION_SECRET ??= "test-admin-session-secret-test-admin";
process.env.ADMIN_URL ??= "http://localhost:5173";
process.env.API_URL ??= "http://localhost:3000";
// Public app origin (MOCK_PUBLIC_BASE_URL defaults to APP_URL + /m).
process.env.APP_URL ??= "http://localhost:8080";
// Compose Redis maps to host 6380 (6379 often taken by a local install).
// Redis holds no source-of-truth data, so unlike DATABASE_URL there is no
// data-loss risk in sharing the dev instance.
process.env.REDIS_URL ??= "redis://localhost:6380";
process.env.LOG_LEVEL ??= "silent";
// Mockvl (spec 2026-10-07). APP_GOOGLE_ALLOWED_HD is deleted, not
// defaulted: domain-restriction tests inject `allowedHd` explicitly, and a
// value leaking from the root .env would reject every test sign-in.
delete process.env.APP_GOOGLE_ALLOWED_HD;
process.env.MOCK_RATE_LIMIT_PER_MINUTE ??= "600";
process.env.MOCK_OPS_CACHE_SIZE ??= "200";
