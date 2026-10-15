---
title: Setup & First Run
description: Get the API, database, Redis, and worker running locally and verify everything works.
order: 2
---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- Docker (local PostgreSQL + Redis)
- A Google OAuth client — only needed for admin dashboard work; skip it for pure API development

## First-time setup

```bash
git clone <repo> && cd <repo>
docker compose up -d      # PostgreSQL 16 + Redis 7
bun install
cp .env.example .env
bun run db:migrate        # apply Drizzle migrations
```

The compose services map to non-default host ports so they never collide with natively installed servers:

| Service | Image | Host port | Container port |
|---|---|---|---|
| postgres | postgres:16-alpine | 5433 | 5432 |
| redis | redis:7-alpine | 6380 | 6379 |

`DATABASE_URL` and `REDIS_URL` in `.env.example` already match these ports — no edits needed for local dev.

### Secrets you must generate

Two keys in `.env` are empty on purpose and must be at least 32 characters. Generate each with:

```bash
openssl rand -hex 32
```

| Key | Used for |
|---|---|
| `JWT_SECRET` | Signing app-user access tokens |
| `ADMIN_SESSION_SECRET` | HMAC-keying admin session tokens stored in the DB |

Every variable in `.env` is validated at boot by `apps/api/src/config/env.ts` — a missing or invalid value crashes startup with a readable list of what's wrong. The Google OAuth keys (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_HD`) can stay empty until you work on admin auth. Full key list in the [Env Reference](/architecture/env-reference/).

## Run

Run everything from the repo root — Bun loads the root `.env` and the `db:*` scripts depend on it.

```bash
bun run dev               # API on http://localhost:3000, watch mode
```

In dev, pg-boss workers run **in-process** with the API — one command gives you the whole system. For the production-style split (or to scale workers independently), run them as a separate process:

```bash
bun run worker            # pg-boss workers only, no HTTP server
```

Both can run at once; pg-boss guarantees each job is delivered to exactly one worker.

## Verify it works

Every route is served under `API_BASE_PATH` (default `/api`):

| Check | Expect |
|---|---|
| `curl http://localhost:3000/api/health` | 200 — liveness, always |
| `curl http://localhost:3000/api/ready` | 200 — pings DB + Redis; a 503 envelope names the failing dependency in `details` |
| http://localhost:3000/api/docs | Scalar interactive API reference |
| http://localhost:3000/api/openapi.json | Raw OpenAPI 3.2 spec |

The `/docs` and `/openapi.json` routes exist only while `DOCS_ENABLED=true` — disable or admin-gate them in production.

If `/ready` returns 503, the containers aren't up: `docker compose up -d`, then check `docker compose ps`. More failure modes in [Troubleshooting](/reference/troubleshooting/).

## Optional: the admin dashboard

For admin work, run the admin app alongside the API:

```bash
cd apps/admin && bun run dev   # Vite on http://localhost:8000
```

The API's `.env` must have `ADMIN_URL=http://localhost:8000` (it is the CORS origin and the post-login redirect — the admin app runs on port 8000, not Vite's default 5173). Sign-in and roles are covered in [Admin Auth](/admin/auth/).

## Next

- [How a request flows](/getting-started/request-flow/) — the middleware chain, layering, and error model
- [Command reference](/getting-started/commands/) — every script, grouped by area
