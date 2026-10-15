---
title: How a Request Flows
description: The middleware chain, Zod validation at the boundary, route-service-repo layering, and the error model.
order: 3
---

## The big picture

```
HTTP → global middleware chain
     → route   (Zod validation via @hono/zod-openapi — HTTP concerns only)
     → service (business logic — throws AppError subclasses, no Hono imports)
     → repo    (Drizzle queries only)
     → response envelope
```

Every response — success or failure — carries an `X-Request-Id` header, and every error envelope echoes the same id, so a client report maps straight to the server logs.

## Global middleware chain

Applied in `apps/api/src/app.middleware.ts` before any route mounts, in this exact order (order matters — each entry documents why):

| # | Middleware | What it does |
|---|---|---|
| 1 | `requestId()` | Generates the request id used by logs and error envelopes |
| 2 | `requestLogger()` | Structured JSON request logging (redacts credentials) |
| 3 | `secureHeaders()` | Hono defaults: nosniff, frame options, HSTS, etc. |
| 4 | `cors(...)` | Explicit allow-list — only the `ADMIN_URL` origin, with `credentials: true`. Never a wildcard with credentials |
| 5 | Global rate limit | 100 req/min/IP by default; `/health` and `/ready` are exempt so probes can neither be throttled nor starve the budget |
| 6 | Auth rate limit | Strict tier (10 req/min/IP default) on `/auth/*` and `/admin/auth/*`; `/admin/auth/me` is exempt (it's a cookie read the admin shell calls on every navigation) |
| 7 | `adminCsrf()` | Mutating `/admin/*` requests must send `X-Requested-With` (SameSite=Lax + custom header CSRF stance) |
| 8 | `jsonOnly()` | Mutating requests with a body must be `Content-Type: application/json`, else 415 |
| 9 | `bodyLimit(...)` | 1 MiB cap; larger bodies get a 413 `PAYLOAD_TOO_LARGE` envelope |

All rejections use the standard error envelope — a rate-limited request looks structurally identical to a 404.

## Validation at the boundary

Routes are `createRoute()` definitions from `@hono/zod-openapi`, built on `createRouter()` from `apps/api/src/lib/openapi.ts`. The same Zod schemas that validate requests at runtime generate the OpenAPI spec, so `/api/docs` can never drift from actual behavior.

The router's shared `defaultHook` turns any schema failure into a standard 400:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": { "issues": ["..."] },
    "requestId": "..."
  }
}
```

Request/response schemas live in `packages/schemas` (one file per model) — shared with the admin app, never duplicated.

## Route → service → repo

Each feature lives in `apps/api/src/modules/<name>/` with a strict split:

```typescript
// comments.routes.ts — HTTP only: validate, call service, wrap in envelope
// comments.service.ts — business logic; throws NotFoundError etc.; no Hono imports
// comments.repo.ts — Drizzle queries only

export const createCommentsRepo = (db: Db) => ({ ... });
export const createCommentsService = ({ repo }: Deps) => ({ ... });
```

Everything is wired with factory functions taking deps as params. `createApp()` (the composition root in `apps/api/src/app.ts`) builds the real graph from `db` + env; tests inject mocks via `createApp({ authService, ... })`. No DI container.

## Errors: one global handler

Services throw `AppError` subclasses from `lib/errors.ts` — `ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409), `RateLimitError` (429), `UpstreamError` (502). A single global `onError` (`lib/error-handler.ts`) maps them:

- `AppError` → `{ error: { code, status-mapped, message, details?, requestId } }`
- Anything else → logged in full server-side, returned as a generic 500. Internals and stack traces never reach the client.

## Response envelopes

| Shape | When |
|---|---|
| `{ "data": { ... } }` | Single resource |
| `{ "data": [...], "meta": { "page", "pageSize", "total" } }` | Lists |
| `{ "error": { "code", "message", "details?", "requestId" } }` | Any failure |

List endpoints share one query contract: `?page=1&pageSize=20&sort=createdAt:desc&filter[status]=published&filter[title][like]=hello` — operators `eq` (default), `like`, `in`, `gte`, `lte`; `pageSize` max 100. Details in [Core Conventions](/architecture/conventions/).

## Rate limiting: sizing for your traffic

Both tiers are Redis-backed in production (one shared budget across all instances) and tuned entirely via env — no code change needed:

| Env key | Default | Applies to |
|---|---|---|
| `RATE_LIMIT_GLOBAL_LIMIT` / `RATE_LIMIT_GLOBAL_WINDOW_MS` | 100 / 60000 | everything (`/health`, `/ready` exempt) |
| `RATE_LIMIT_AUTH_LIMIT` / `RATE_LIMIT_AUTH_WINDOW_MS` | 10 / 60000 | `/auth/*`, `/admin/auth/*` (`/me` exempt) |
| `TRUST_PROXY` | false | which IP source keys the counters |

Set `TRUST_PROXY=true` when a reverse proxy you control (nginx ingress, LB) fronts the API — the client IP then comes from `x-real-ip` or the rightmost `x-forwarded-for` hop. Leave it `false` when exposed directly: forwarded headers are client-forgeable and get ignored.

The limits are **per IP**, and behind carrier-grade NAT (common on mobile networks) one address can carry hundreds of real users. Size the global tier as a flood backstop, not a fairness control: `max users per IP × requests per user per minute × 2` — high-CGNAT consumer traffic often needs 2000+/min. Watch 429 rates and hot keys after deploying:

```bash
redis-cli --scan --pattern 'rl:global:*'
```

On a Redis outage the limiter fails open by default (requests served, `RATE_LIMIT_STORE_DOWN` logged); set `RATE_LIMIT_FAIL_OPEN=false` to fail closed. More in the [Redis guide](/guides/redis/).
