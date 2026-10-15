---
title: Core Conventions
description: The response envelopes, list query contract, error model, layering rules, validation, env access, and logging that every endpoint in the repo follows.
order: 2
---

Every endpoint in this repo — hand-written module or generated admin CRUD — follows the same small set of rules. Learn them once and every file in `apps/api` reads the same way.

## The three envelopes

Every response is exactly one of three shapes (helpers live in `packages/schemas/src/common.ts`):

```json
{ "data": { "id": "…", "title": "…" } }
```

```json
{ "data": [{ "id": "…" }], "meta": { "page": 1, "pageSize": 20, "total": 137 } }
```

```json
{ "error": { "code": "NOT_FOUND", "message": "Resource not found", "details": {}, "requestId": "…" } }
```

| Shape | When |
|---|---|
| `{ data }` | Single resource |
| `{ data, meta }` | Lists — `meta` carries `page`, `pageSize`, `total` |
| `{ error: { code, message, details?, requestId } }` | Any failure |

Clients can rely on this: success always has `data`; failure always has a machine-readable `error.code` and an `error.requestId` that matches the server logs (every response also carries an `X-Request-Id` header). You never build these by hand — routes return `c.json({ data })`, and the global error handler builds every error envelope from thrown `AppError`s.

## The list query contract

Every list endpoint accepts the same query string (implemented in `apps/api/src/lib/pagination.ts`):

```http
GET /api/admin/posts?page=1&pageSize=20&sort=createdAt:desc&filter[status]=published&filter[title][like]=hello
```

| Parameter | Rules |
|---|---|
| `page` | 1-based, default 1 |
| `pageSize` | default 20, **max 100** |
| `sort` | `field:dir`, comma-separated multi-sort allowed (`sort=status:asc,createdAt:desc`) |
| `filter[field]=v` | shorthand for `filter[field][eq]=v` |
| `filter[field][op]=v` | ops: `eq`, `like` (ILIKE `%v%`), `in` (comma list), `gte`, `lte` |

Fields are strictly allow-listed via the `ResourceField[]` metadata in `packages/schemas`:

- `sort` requires the field to be `sortable`
- `like` requires `searchable`
- the other filter ops require `filterable`

Values are validated against the field type at the boundary, so undeclared columns are unreachable and garbage values are 400s, not Postgres errors. ILIKE wildcards in filter values are escaped — `%` and `_` are treated as data, not patterns.

## Errors

All failures flow through `AppError` subclasses in `apps/api/src/lib/errors.ts`. Real code:

```typescript
export class AppError extends Error {
  readonly code: string;
  readonly status: ErrorStatus;
  readonly details?: unknown;

  constructor(code: string, status: ErrorStatus, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", details?: unknown) {
    super("NOT_FOUND", 404, message, details);
  }
}
```

The full set: `ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409), `RateLimitError` (429), `UpstreamError` (502).

One global `onError` (wired in `lib/error-handler.ts`) maps them:

- an `AppError` becomes the error envelope with its `code`, `status`, `message`, `details`, plus the `requestId`
- any unknown error is logged in full server-side and returned as a generic 500 — internals and stack traces **never** reach the response

Services throw; routes never `try/catch` to format errors. Schema failures from `@hono/zod-openapi` are turned into the standard 400 `VALIDATION_ERROR` envelope by a shared `defaultHook` in `lib/openapi.ts`.

## Layering

Each feature in `apps/api/src/modules/<name>/` is three files with hard boundaries:

| Layer | File | Allowed to | Never |
|---|---|---|---|
| Route | `<name>.routes.ts` | Validate (Zod), call service, serialize | Business logic, DB access |
| Service | `<name>.service.ts` | Business rules, throw `AppError`s | Import Hono, touch Drizzle |
| Repo | `<name>.repo.ts` | Drizzle queries | Throw domain errors, know HTTP |

Everything is wired with factory functions taking dependencies as parameters — that is the entire DI story, no container framework:

```typescript
const userRepo = createUserRepo(db.$primary);
const usersService = createUsersService({ userRepo });
```

`createApp()` builds the real graph from `db` + env (`app.defaults.ts`); tests inject fakes via `createApp({ usersService })`. See [Request Flow](/getting-started/request-flow/) for the end-to-end picture and the [Module Generator](/generators/module-generate/) for scaffolding a new module.

## Validation and schemas

All request/response validation goes through Zod via `@hono/zod-openapi` `createRoute()` definitions, so the OpenAPI spec at `/openapi.json` is derived from the same schemas that validate requests — the docs cannot drift from the code.

Model schemas and field metadata live in `packages/schemas`, **one file per model**, in the same file so they cannot drift from each other. A real excerpt from `packages/schemas/src/post.ts`:

```typescript
export const postFields: ResourceField[] = [
  { name: "title", type: "string", label: "Title", required: true, listColumn: true, searchable: true },
  { name: "status", type: "enum", label: "Status", options: [...POST_STATUSES], listColumn: true, filterable: true },
  {
    name: "categoryId",
    type: "relation",
    label: "Category",
    resource: "categories",
    displayField: "name",
    listColumn: true,
    filterable: true,
  },
  { name: "createdAt", type: "date", label: "Created", listColumn: true, sortable: true, readOnly: true },
];
```

These flags drive both the list-query allow-lists above and the generic admin UI ([Resource Registry](/admin/resource-registry/)). New model files are scaffolded with [schemas:generate](/generators/schemas-generate/).

## Environment access

Env is read in exactly one place: `apps/api/src/config/env.ts`, Zod-parsed at import time so a misconfigured process fails at boot, not on the first request that touches a missing value. Never read `process.env` anywhere else, and keep `.env.example` updated with every new key. Full variable list: [Env Reference](/architecture/env-reference/).

## Logging

Structured JSON logging (pino, `apps/api/src/lib/logger.ts`) with the `requestId` on every request-scoped line. Redaction is enforced inside the logger itself — before anything reaches the log stream, values are replaced with `[Redacted]` for:

- `authorization`, `cookie`, `set-cookie`, `password` (exact match, case-insensitive)
- any key ending in `key`, `secret`, or `token` — snake_case, kebab-case, or camelCase (`API_KEY`, `client-secret`, `refreshToken`)

Never log credentials or third-party request headers; the outbound HTTP client (`clients/http.ts`) is built so provider headers and bodies cannot appear in error messages, details, or logs.

## Where each rule is enforced

| Rule | Enforced by |
|---|---|
| Envelopes | `lib/error-handler.ts` + response schemas in `packages/schemas` |
| Query contract | `lib/pagination.ts` + `ResourceField` allow-lists |
| Error mapping | Single global `onError` |
| Validation | `createRoute()` + shared `defaultHook` in `lib/openapi.ts` |
| Env | `config/env.ts` fail-fast parse |
| Redaction | `redactSecrets()` in the logger serializers and formatters |

The security-critical conventions (tokens, sessions, CORS, rate limits) have their own page: [Security Model](/architecture/security-model/).
