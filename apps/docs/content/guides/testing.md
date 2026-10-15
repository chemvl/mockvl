---
title: Testing
description: How the unit/integration/e2e split works, the helpers and fakes to copy, and how to run and debug the suite.
order: 7
---

Tests run with Bun's built-in runner — no Jest, no Vitest, no extra config. Everything lives in `apps/api/tests/`, split by what it needs to run:

```bash
bun test                    # everything (alias for bun test apps/api)
bun run test:unit           # apps/api/tests/unit — no external services
bun run test:integration    # apps/api/tests/integration — needs Postgres (+ Redis)
bun run test:e2e            # apps/api/tests/e2e — needs Postgres (+ Redis)
```

CI runs typecheck → lint → tests → docker build on every push, against Postgres 16 + Redis 7 service containers.

## The three layers

### Unit (`tests/unit/`)

No external services at all — `bun run test:unit` works without Docker. What lives here:

- **Services with fake repos/clients** — e.g. `mocks-service.test.ts`, `workspaces-service.test.ts`, `admin-notifications-service.test.ts`. Because every service is a factory taking deps as params, a "mock" is just a plain object implementing the repo's type.
- **Route handlers with injected fakes** — `auth-routes.test.ts`, `crud-routes.test.ts` build the app via `createApp({ ...fakeServices })` and hit it with `app.request()`, still without a database.
- **Middleware** — `auth-middleware.test.ts`, `admin-middleware.test.ts`, `rate-limit-redis-store.test.ts`.
- **Pure utilities and contracts** — `pagination.test.ts`, `errors.test.ts`, `post-schemas.test.ts` (schema pins), `registry.test.ts` (the boot-time cross-checks), the generator tests (`schema-gen-*.test.ts`, `module-gen-*.test.ts`).
- **HTTP transport** — `http-client.test.ts` uses a scripted `fetch` stub plus injected `sleepFn`/`randomFn`, so retries and backoff are asserted without real delays — and it asserts serialized errors never contain the API key.

### Integration (`tests/integration/`)

Real infrastructure, thin scope: repos against the compose Postgres (`admin-repos.test.ts`, `auth-repos.test.ts`, `notifications-repos.test.ts`), the DB client, pg-boss lifecycle (`jobs.test.ts`), and the Redis layers (`redis.test.ts`, `cache.test.ts`, `primitives.test.ts`, `rate-limit-redis-store.test.ts`).

### E2E (`tests/e2e/`)

The fully wired app — real routes → services → repos → DB — exercised through `await app.request("/api/...")`. No HTTP server is started; Hono's `app.request()` runs the whole middleware stack in-process. Note that e2e paths **include the `/api` base path**, unlike route paths in code. Examples: `auth-e2e.test.ts` (Google sign-in → refresh → logout), `admin-crud-e2e.test.ts` (registry CRUD with minted admin sessions — no Google involved), `mocks-api-e2e.test.ts`, `push-notifications-e2e.test.ts`.

## The test database is automatic — and isolated

Integration and e2e suites never touch your dev database:

- `tests/setup.ts` (imported first in every test file) **force-assigns** `DATABASE_URL` to a separate `app_test` database (`postgres://postgres:postgres@localhost:5433/app_test`) before `config/env.ts` parses the env. `bun test` from the repo root auto-loads the root `.env`, so this is deliberately a force-assign, not a default — your dev `DATABASE_URL` can never leak into tests. Override with `TEST_DATABASE_URL` (CI does).
- `tests/helpers/test-db.ts` exports `prepareTestDatabase()`: it creates `app_test` if missing and applies all Drizzle migrations. It's memoized, so every DB-touching suite calls it from `beforeAll` and only the first one pays.

So the only prerequisite is `docker compose up -d` — no manual migrate step for tests. Redis is shared with dev (host port 6380); it holds no source-of-truth data, so there's no isolation concern.

## Helper and fake patterns to copy

**Fake repos are plain objects.** The repo type is `ReturnType<typeof createXRepo>`, so a fake is any object satisfying it:

```typescript
import type { WorkspacesRepo } from "@/modules/workspaces/workspaces.repo";

const fakeRepo: WorkspacesRepo = {
  listForUser: async () => [],
  findMembership: async () => undefined,
  findPersonal: async () => undefined,
  slugExists: async () => false,
  insertPersonal: async ({ slug, name }) => ({ id: crypto.randomUUID(), slug, name, role: "owner", personal: true }),
};

const service = createWorkspacesService({
  workspacesRepo: fakeRepo,
  userRepo: { findById: async () => undefined }, // deps can be narrowed with Pick<>
});
```

**Shared fakes live in `tests/helpers/`.** `tests/helpers/push-fakes.ts` is the worked example: in-memory repo fakes for the push pipeline that mirror the real repos' guard semantics (status-gated updates, the inbox unique index), plus row factories like `notificationRow(overrides)` and `deviceRow(overrides)`. When several suites need the same fake, promote it here instead of copy-pasting.

**Services are injected through `CreateAppOptions`.** Route and e2e tests build the app with exactly the services they want to control:

```typescript
const app = createApp({
  workspacesService: services.workspacesService,
  mocksService: services.mocksService,
  rateLimit: { global: { windowMs: 60_000, limit: 10_000 } },
});
const res = await app.request("/api/workspaces");
```

(Relaxing the rate limit in e2e suites keeps loops of requests from tripping 429s.)

**Third-party providers are never real.** Every provider client is consumed through an interface, so tests inject a fake implementing it (push uses FCM fakes; a provider you add ships a `mock.ts` alongside its client). Fakes mirror the real client's failure shapes — e.g. the same `UpstreamError` the real client throws on an upstream 404 — so tests exercise the production error paths. See [Third-Party API Clients](/guides/third-party-clients/).

## Running a single file or test

```bash
bun test apps/api/tests/unit/mocks-service.test.ts        # one file
bun test apps/api/tests/unit                              # one directory
bun test apps/api -t "throws NotFoundError"               # filter by test name
```

## When tests fail: fix the code, not the test

House rule: a failing test means the code is wrong — change the implementation until the test passes. Only change the test when the test itself contradicts the documented contract (envelopes, query contract, layering — see [Core Conventions](/architecture/conventions/)). Weakening an assertion to get green is how security rules quietly erode; if a test seems impossible to satisfy without weakening a guard, stop and question the change instead.

## Known flake: Redis-down simulation under load

Some Redis tests simulate an outage with timing: an unreachable address (e.g. `redis://127.0.0.1:1`, where connection is refused) plus assertions that operations reject *fast* instead of hanging, and `setTimeout`-based sequencing in the cache/primitives suites. When your machine is busy — a build in another terminal, a heavy IDE index — those timing windows can be missed and the tests fail **randomly, without any code being wrong**.

Before blaming your change:

```bash
bun test apps/api/tests/integration/redis.test.ts
```

Re-run the failing file in isolation on an idle machine. If it passes alone and only fails inside the full busy-machine run, it's the flake, not your code. If it fails in isolation too, it's real — go fix it.

## Checklist before calling work done

```bash
bun run typecheck && bun run lint && bun test apps/api
```

All three gates pass locally, new services have unit tests with fakes, anything touching the DB or the HTTP surface has an integration or e2e test, and you ran the endpoints by hand at least once (e.g. via the Scalar UI at `/api/docs`). More failure signatures live in [Troubleshooting](/reference/troubleshooting/).
