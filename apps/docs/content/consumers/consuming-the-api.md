---
title: Consuming the API
description: The envelope contract, list query parameters, auth flow, and typed-client setup for any frontend or mobile app talking to this API.
order: 1
---

## The contract, from the client's side

Every endpoint responds in exactly one of three shapes. Your client code can rely on this without exception: success always has `data`, failure always has `error.code` and `error.requestId`.

```json
{ "data": { "id": "…", "title": "…" } }
```

```json
{ "data": [ { "id": "…" } ], "meta": { "page": 1, "pageSize": 20, "total": 137 } }
```

```json
{ "error": { "code": "NOT_FOUND", "message": "Mock not found", "requestId": "9f0e2b1c-…" } }
```

Validation failures add a `details` object to the error. Everything is served under the API base path (default `/api`), so `GET /users/me` in the docs means `GET https://your-host/api/users/me` on the wire.

### Unwrapping in a fetch wrapper

Centralize envelope handling in one place — the rest of your app never sees raw responses:

```typescript
class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = await res.json();
  if (!res.ok) {
    const e = body.error ?? {};
    throw new ApiError(e.code ?? "UNKNOWN", e.message ?? res.statusText, e.requestId, e.details);
  }
  return body as T; // { data } or { data, meta }
}
```

Rules of thumb:

- Branch on `error.code` — it is stable and machine-readable (`VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `RATE_LIMITED`, `UPSTREAM_ERROR`, …). Never parse `error.message`.
- Show `error.message` to users; it is written to be safe to display.
- Log `error.requestId` and include it in bug reports — it is the string that finds the exact request in the server logs.
- `meta.total` drives pagination UIs.

## List query parameters

Every list endpoint shares one query contract:

| Parameter | Example | Notes |
|---|---|---|
| `page` | `page=2` | 1-based |
| `pageSize` | `pageSize=20` | max 100 |
| `sort` | `sort=createdAt:desc` | `field:asc` or `field:desc` |
| `filter[field]` | `filter[status]=running` | operator defaults to `eq` |
| `filter[field][op]` | `filter[title][like]=hello` | ops: `eq`, `like`, `in`, `gte`, `lte` |

A combined request, URL-encoded as your HTTP library will send it:

```http
GET /api/workspaces/jane/mocks?page=1&pageSize=20&sort=updatedAt:desc&filter%5Bstatus%5D=running HTTP/1.1
Host: api.example.com
```

Which is the readable form:

```text
/api/workspaces/jane/mocks?page=1&pageSize=20&sort=updatedAt:desc&filter[status]=running
```

Sorting and filtering are allow-listed per endpoint — a field that is not flagged sortable or filterable returns a `400`, not an empty result. Check the live docs for what each endpoint accepts.

## Auth: Google sign-in, Bearer token, refresh

App users authenticate with JWTs — no cookies, so mobile clients need no CORS or cookie handling at all.

1. Sign in with Google: `POST /auth/google` with a client-obtained ID token, or `POST /auth/google/code` with a Google Identity Services popup code — either returns an access token (15-minute lifetime) and a refresh token. There is no email/password login.
2. Send the access token on every protected request:

```http
GET /api/users/me HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

3. When you receive a `401` (or proactively before the 15 minutes elapse), call `POST /auth/refresh` with the refresh token to get a fresh pair.

The refresh token is single-use and rotates on every refresh — always store the new one returned by `/auth/refresh` and discard the old. Reusing an old refresh token revokes the whole token family as a security measure, forcing a re-login.

Full endpoint payloads, token lifetimes, and the admin session model are on the [auth cheat sheet](/reference/auth-cheat-sheet/).

## Typed client: generate, don't hand-write

The API publishes an OpenAPI 3.2 document at `/api/openapi.json`, derived from the same Zod schemas that validate requests at runtime — so generated types cannot drift from server behavior. See [the live API reference](/consumers/live-api-reference/) for the docs UI and spec details.

The admin app generates a full TypeScript SDK from this spec with `@hey-api/openapi-ts`:

```bash
bun run dev                                   # API must be serving /api/openapi.json
cd apps/admin && bun run client:generate      # regenerates src/client/
```

Function names derive from each route's `operationId` — `GET /api/workspaces/{ws}/mocks` (operationId `listMocks`) becomes `listMocks` — with TanStack Query helpers alongside:

```tsx
import { useQuery } from "@tanstack/react-query";
import { listMocksOptions } from "../client/@tanstack/react-query.gen";

function MockList({ ws }: { ws: string }) {
  const { data, isPending, error } = useQuery(
    listMocksOptions({ path: { ws }, query: { page: "1", pageSize: "10", sort: "updatedAt:desc" } }),
  );
  // data.data is MockListItem[] (typed!), data.meta.total drives the pager
}
```

A separate frontend (mobile app, marketing site) can run the same generator against `http://localhost:3000/api/openapi.json` — copy the config from `apps/admin/openapi-ts.config.ts`. Note that there is currently no shared `packages/api-client` package in the repo; each consumer generates its own client from the spec.

Whenever the API changes, regenerate — stale types are the most common cause of "the API changed and my build didn't notice".

## CORS notes

- The API allows exactly one browser origin: the admin URL from `env.ADMIN_URL`, with credentials. A new browser frontend on another origin must be added to the `cors()` config in `apps/api/src/app.ts` (extend it to a list of origins from env). Never `*` — browsers reject it with credentials anyway.
- Mobile and server-side clients are unaffected: Bearer-token auth involves no cookies, so CORS does not apply.
- In production, prefer serving frontend and API under one domain behind a reverse proxy so browsers avoid cross-origin requests entirely.

## Quick troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401` with a token attached | Header is not `Authorization: Bearer <token>`, the access token expired (15 min — refresh it), or you sent the refresh token instead of the access token |
| `400` "Field is not sortable/filterable" | The field is not in that endpoint's allow-list — check the live docs |
| `415` / `413` on writes | Missing `Content-Type: application/json` / body over 1 MB |
| `429` during development | Per-IP rate limiter; wait a minute or raise the limit locally |
| Browser CORS error | Your origin is not in the API's `cors()` origin list |
| Generated types are stale | Re-run the client generator with the API running |

More in [troubleshooting](/reference/troubleshooting/).
