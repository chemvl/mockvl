---
title: Monorepo Layout
description: How the Bun workspaces are organized and where every kind of code lives.
order: 1
---

The repo is a Bun workspaces monorepo — the root `package.json` declares `"workspaces": ["apps/*", "packages/*"]`. There is no Turborepo or Nx; plain Bun workspaces and root-level scripts are enough at this size.

## Workspaces at a glance

| Workspace | What it is |
|---|---|
| `apps/api` | The Hono API on Bun: public modules, admin realm, jobs, clients, middleware |
| `apps/admin` | Ant Design Pro admin app (React 19, antd v6, react-router v7), merged in via `git subtree`, wired to the API with headless Refine |
| `apps/docs` | This documentation site |
| `packages/schemas` | Shared Zod schemas + field metadata — the API contract, one file per model |
| `packages/config` | Shared baseline: `tsconfig.base.json` and `biome.json` |

One note on drift: The original build plan also mentioned a `packages/api-client` package generated from `openapi.json`. It does **not** exist on disk yet — a typed client package is planned but not present. Consumers currently generate their own client from `/openapi.json` (see [Consuming the API](/consumers/consuming-the-api/)).

## apps/api/src — annotated tree

This is the real tree on disk (folder names verified), which has grown past the original plan as phases landed:

```text
apps/api/src/
├── index.ts               # bootstrap: env, DB, Redis, pg-boss, graceful shutdown
├── worker.ts              # pg-boss workers only — no HTTP server (bun run worker)
├── app.ts                 # Hono app assembly under API_BASE_PATH
├── app.middleware.ts      # global middleware chain (request-id → … → body limit)
├── app.defaults.ts        # default dependency graph; tests override via createApp({...})
├── config/
│   └── env.ts             # Zod-parsed env, fails at boot — the ONLY process.env reader
├── db/
│   ├── client.ts          # postgres.js pool + Drizzle instance
│   ├── schema/            # one file per feature + index.ts barrel
│   └── migrations/        # drizzle-kit output — never hand-edited
├── modules/               # public API: hand-written routes → service → repo
│   ├── auth/              # google (ID token + popup code)/refresh/logout (JWT)
│   ├── users/             # GET /users/me
│   ├── workspaces/        # /workspaces (personal workspace)
│   ├── mocks/             # /workspaces/{ws}/mocks, versions, schema import
│   ├── usage/             # /workspaces/{ws}/usage
│   ├── mock-runtime/      # /m/* Prism mock runtime
│   ├── devices/           # repo only — push fan-out queries for the worker
│   ├── notifications/     # repos only — notifications + inbox rows for the worker
│   ├── things/            # third-party proxy example (example provider)
│   └── system/            # /health, /ready
├── admin/                 # admin realm: Google OIDC + generic CRUD
│   ├── auth/              # OIDC flow, sessions, RBAC service
│   ├── registry/          # resource defs + generic crud.repo/service/routes
│   ├── notifications/     # admin push-send pipeline
│   ├── meta.routes.ts     # GET /admin/meta/resources
│   └── mount.ts           # mounts the whole /admin surface
├── clients/               # outbound HTTP only
│   ├── http.ts            # createHttpClient: timeout, retries, UpstreamError mapping
│   ├── token-cache.ts     # OAuth client-credentials token cache (single-flight)
│   ├── example/           # worked example: types + real client + mock
│   └── fcm/               # FCM push sender (+ log-only fallback)
├── jobs/
│   ├── boss.ts            # pg-boss singleton + typed enqueue()
│   ├── types.ts           # job payload Zod schemas → JobPayloads map
│   └── workers/           # one file per worker (welcome-email, push, …)
├── middleware/            # request-id, request-logger, auth, admin-auth,
│                          # admin-csrf, rate-limit(+redis store), json-only
└── lib/                   # errors, error-handler, logger, openapi, pagination,
                           # cache, redis, primitives, sanitize, serialize, …
```

The layering rule that governs which folder may import what is on [Core Conventions](/architecture/conventions/). Tests live outside `src` in `apps/api/tests/` (`unit/`, `integration/`, `e2e/`) — see [Testing](/guides/testing/).

## apps/admin

An existing Ant Design Pro application brought in with `git subtree add` (Phase 10), so it keeps its own history, tooling, and product backend. The API integration is confined to `apps/admin/src/refine/`:

```text
apps/admin/src/refine/
├── dataProvider.ts        # list convention → API query string
├── authProvider.ts        # admin cookie session
├── accessControlProvider.ts
├── http.ts                # credentials: 'include', X-Requested-With on writes
├── resources.ts           # bootstrapped from GET /admin/meta/resources
└── pages/                 # generic ResourceList / ResourceForm
```

It runs on port 8000 in dev (`bun run dev` inside `apps/admin`), which is why the API's `ADMIN_URL` defaults to `http://localhost:8000`. Details in [Admin Frontend](/admin/frontend/).

## packages/schemas — the keystone

One file per model (`post.ts`, `user.ts`, `category.ts`, `mock.ts`, `notification.ts`, …), each exporting:

- the Zod schemas (`XCreateSchema`, `XUpdateSchema`, output `XSchema`) used by both API validation and OpenAPI generation, and
- a `fields: ResourceField[]` metadata array that drives the generic admin list/form rendering and the list-query allow-lists.

Keeping schemas and field metadata in the same file means they cannot drift from each other; the admin registry cross-checks both against the Drizzle table at boot. Files are scaffolded (not hand-started) by [schemas:generate](/generators/schemas-generate/).

## packages/config

The shared baseline every workspace extends: `tsconfig.base.json` and the repo-wide `biome.json`. Biome is the only linter/formatter — there is no ESLint or Prettier in this repo.

## Root-level pieces

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Local Postgres 16 (host port 5433) + Redis 7 (host port 6380) |
| `.github/workflows/ci.yml` | API pipeline: typecheck → biome → tests → Docker build + smoke test |
| `.github/workflows/admin.yml` | Admin pipeline (path-filtered to `apps/admin/**` + `packages/schemas/**`) |
| `biome.json`, `bun.lock` | Repo-wide lint config and the single lockfile |

Run all commands from the repo root — Bun loads the root `.env` there, and the `db:*` scripts depend on it. The full command list is on [Commands](/getting-started/commands/).
