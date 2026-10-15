---
title: Live API Reference
description: Where to find the always-current interactive API docs and OpenAPI spec, and how to generate typed clients from them.
order: 3
---

## The API documents itself

This docs site explains concepts; the endpoint-by-endpoint reference lives in the API itself and is always current. Two routes serve it, both under the API base path (`API_BASE_PATH`, default `/api`):

| What | Route | Local URL |
|---|---|---|
| Interactive docs (Scalar UI) | `{API_BASE_PATH}/docs` | `http://localhost:3000/api/docs` |
| OpenAPI 3.2 document | `{API_BASE_PATH}/openapi.json` | `http://localhost:3000/api/openapi.json` |

The spec is not hand-maintained: it is derived from the same Zod schemas that validate every request and response at runtime, via `@hono/zod-openapi`. If an endpoint's behavior changes, its documentation changes in the same commit — the reference cannot drift from the server.

Use the Scalar UI to browse endpoints, inspect request and response schemas (including the envelope shapes and error codes), and fire test requests against a running instance.

## Availability

Both routes are gated by the `DOCS_ENABLED` environment variable (default `true`). When it is `false`, `/docs` and `/openapi.json` return 404 — typical for production deployments. See the [environment reference](/architecture/env-reference/) for the full variable list.

If you need the spec from an environment where docs are disabled, run the API locally:

```bash
bun run dev
curl http://localhost:3000/api/openapi.json
```

## Using the spec for codegen

The OpenAPI document is the input for typed clients — never hand-write API types. Any generator that accepts OpenAPI 3.2 (or treats it as 3.1 — the versions are backward compatible) works. Two common options:

Types only, with `openapi-typescript`:

```bash
bunx openapi-typescript http://localhost:3000/api/openapi.json -o src/api-types.d.ts
```

```typescript
import type { paths } from "./api-types";

type MockList =
  paths["/api/workspaces/{ws}/mocks"]["get"]["responses"]["200"]["content"]["application/json"];
```

A full SDK with TanStack Query helpers, with `@hey-api/openapi-ts` — this is what the admin app uses (`cd apps/admin && bun run client:generate`); copy its `openapi-ts.config.ts` for your own frontend.

Regenerate whenever the API changes. The workflow, envelope handling, and client patterns are covered in [consuming the API](/consumers/consuming-the-api/).

## Quick checks

- `GET /api/health` returns 200 when the API process is up.
- `GET /api/ready` returns 200 when its dependencies (Postgres, Redis) are reachable; a 503 names the failing dependency in the error `details`.
- If `/api/docs` 404s, either `DOCS_ENABLED=false` or your deployment uses a non-default `API_BASE_PATH`.
