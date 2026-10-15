---
title: Troubleshooting
description: Symptoms, causes, and fixes for the most common problems across setup, database, validation, auth, admin dashboard, and jobs.
order: 2
---

Find your symptom below. Each entry gives the cause and the fix. Areas are ordered roughly by when you hit them: boot problems first, runtime problems later.

## Setup & boot

### Boot crashes listing environment variable names

Cause: required keys are missing from `.env` — env parsing is fail-fast by design. Fix: copy the new keys from `.env.example` into `.env` (see /architecture/env-reference/). Note that empty strings do not count as set for secrets like `JWT_SECRET`.

### `GET /api/ready` returns 503

Cause: Postgres or Redis isn't up — the envelope's `details` names which dependency failed. Fix: `docker compose up -d`, then check `docker compose ps`. Both containers have healthchecks.

### Cannot connect to Postgres/Redis even though something is listening

Cause: the compose file deliberately maps non-default host ports to avoid colliding with natively installed services — Postgres on **5433** (not 5432) and Redis on **6380** (not 6379). Fix: make sure `DATABASE_URL` and `REDIS_URL` in `.env` point at 5433/6380, and that you aren't accidentally talking to a native install on the default ports.

### `/api/docs` or `/api/openapi.json` returns 404

Cause: `DOCS_ENABLED=false` hides both routes (the intended production setting). Fix: set `DOCS_ENABLED=true` locally.

## Database & migrations

### Schema change not reflected in the database

Cause: you edited the Drizzle table but never generated or applied a migration. Fix: `bun run db:generate && bun run db:migrate`. Never hand-edit generated migration files.

### Migration fails with `column ... contains null values`

Cause: you added a `NOT NULL` column to a table that already has rows. Fix: keep the new column nullable (the approach used in /guides/posts-with-categories/), or backfill in the migration before tightening the constraint.

## Validation & query contract

### 400 `Field is not sortable/filterable`

Cause: the field isn't flagged in the allow-list you passed to `parseListQuery` — sorting needs `sortable: true`, `like` needs `searchable: true`, other operators need `filterable: true`. Fix: add the flag to the field metadata in `packages/schemas`.

### Route missing from `/api/docs`

Cause: the handler was registered with `router.get(...)` instead of `router.openapi(createRoute(...), ...)`, or the router was never mounted in `app.ts`. Fix: use the OpenAPI registration path everywhere; the spec is derived from the same Zod schemas that validate at runtime.

### 404 on a route you just wrote

Cause: you forgot `app.route(...)` in `app.ts`, or you're calling it without the `/api` base path. Fix: mount the router and include `API_BASE_PATH` (default `/api`) in the URL.

### A static route like `/orders/mine` returns 400 "Invalid id"

Cause: `/mine` was registered after `/{id}`, so the param route swallows it. Fix: register static paths before parameterized ones.

### Handler return type errors against the response schema

Cause: the serializer drifted from the output schema. Fix: fix the serializer — that compile error is the feature, not the bug.

### 415 or 413 on writes

Cause: missing `Content-Type: application/json` (415) or a body over 1 MB (413). Fix: send the header; keep payloads under the limit.

## Auth

### 401 on a protected route even though you sent a token

Cause: the header isn't exactly `Authorization: Bearer <token>`, the access token expired (15-minute TTL — refresh it), or you sent a refresh token where an access token belongs. See /reference/auth-cheat-sheet/.

### 429 during development on `/auth/*`

Cause: the strict auth rate-limit tier (default 10/min/IP). Fix: wait a minute, or raise `RATE_LIMIT_AUTH_LIMIT` in your local `.env`.

## Admin dashboard

### Admin login loops back to the sign-in page

Cause: your Google account's domain doesn't match `GOOGLE_ALLOWED_HD`, or the browser is blocking the cookie. Fix: sign in with an allowed-domain account; for cross-origin dev (Vite on 8000, API on 3000) confirm `ADMIN_URL=http://localhost:8000` so CORS runs with `credentials: true`, or use a same-origin proxy setup.

### 403 on mutating `/admin/*` calls from curl or scripts

Cause: missing CSRF header. Fix: send `X-Requested-With: XMLHttpRequest` on every non-GET `/admin/*` request.

### New resource missing from the sidebar

Cause: registry registration is boot-time — the API wasn't restarted — or the signed-in role can't `list` the resource. Fix: restart the API after registering; check `permissions.list` in the resource def.

### Relation dropdown is empty or shows raw ids

Cause: empty — the signed-in admin's role can't `list` the target resource, or no rows exist yet. Raw ids — `displayField` doesn't match a real field of the target's output schema. Fix: check permissions and the `displayField` value (see /admin/resource-registry/).

### Frontend types stale after an API change

Cause: the generated client wasn't regenerated. Fix: with the API running, `cd apps/admin && bun run client:generate`.

## Jobs & Redis

### Redis is down but traffic still flows

Not a bug: rate limiting **fails open** by design (logs `RATE_LIMIT_STORE_DOWN`) unless `RATE_LIMIT_FAIL_OPEN=false`, and cache reads fall through to their origin. Locks and idempotency fail closed instead. See /guides/redis/.

### 502 with a `{ provider: "..." }` error envelope

Cause: the third-party API failed or timed out after retries — your API behaved correctly. Fix: check the provider's status page. If the message is `unexpected response shape`, the provider changed its payload — update the client's Zod schema and mapping (see /guides/third-party-clients/).

### A queued job never runs

Cause: no worker process is consuming the queue in your setup. Fix: workers run in-process with `bun run dev`; if you run API and workers separately, make sure `bun run worker` is up (see /guides/background-jobs/).
