---
title: Command Reference
description: Every root script grouped by area, with when to use each one.
order: 4
---

Run everything from the repo root — Bun loads the root `.env` and the `db:*` scripts depend on it.

## Dev

| Command | What it does | When to use |
|---|---|---|
| `docker compose up -d` | Starts local PostgreSQL 16 (host port 5433) + Redis 7 (host port 6380) | First thing, every time — the API, migrations, and DB-backed tests all need it |
| `bun run dev` | API dev server on http://localhost:3000, watch mode; pg-boss workers run in-process | Daily development — one command runs the whole system |
| `bun run worker` | pg-boss workers only, no HTTP server | Production-style separation, or scaling workers independently; can run alongside `dev` |

## Database

| Command | What it does | When to use |
|---|---|---|
| `bun run db:generate` | Generates a Drizzle migration from schema changes in `apps/api/src/db/schema` | After editing any table definition — never write migrations by hand |
| `bun run db:migrate` | Applies pending migrations to `DATABASE_URL` | After `db:generate`, after pulling migrations, and once during first-time setup |
| `bun run db:studio` | Opens Drizzle Studio against `DATABASE_URL` | Browsing or poking data during development |

## Generators

| Command | What it does | When to use |
|---|---|---|
| `bun run schemas:generate [model] [--force]` | Scaffolds `packages/schemas` model files (Zod schemas + `fields` metadata) and the admin resource def from Drizzle tables; warns on drift instead of overwriting | After adding a table, or to check hand-maintained schemas against the DB. See [schemas:generate](/generators/schemas-generate/) |
| `bun run module:generate <model> [--protected] [--force]` | Scaffolds a public API module (repo/service/routes/tests + wiring) from a schema | Adding a public CRUD surface for a model. See [module:generate](/generators/module-generate/) |

## Quality

| Command | What it does | When to use |
|---|---|---|
| `bun run typecheck` | `tsc --noEmit` over `apps/api` and `apps/docs` | Before committing; after any type-touching change |
| `bun run lint` | Biome check over `apps/api`, `apps/docs`, and `packages` | Before committing — Biome is the only linter/formatter, no ESLint or Prettier |

## Testing

| Command | What it does | When to use |
|---|---|---|
| `bun run test` | Full API suite | Before committing; needs compose Postgres up — the suite creates and migrates its own `app_test` database |
| `bun run test:unit` | Unit tests only (`apps/api/tests/unit`) | Fast feedback loops — no Postgres required |
| `bun run test:integration` | Repo/DB/pg-boss tests (`apps/api/tests/integration`) | After repo or migration changes |
| `bun run test:e2e` | Full-app tests via `app.request()` (`apps/api/tests/e2e`) | After route or wiring changes |

The DB-backed slices never touch your dev database — details in the [testing guide](/guides/testing/).

## Docs site

| Command | What it does | When to use |
|---|---|---|
| `bun run docs:dev` | Serves this documentation site on http://localhost:4000, rebuilding on change (`DOCS_PORT` overrides the port) | Writing or reviewing docs |
| `bun run docs:build` | Builds the static docs site | CI / deployment |

Not to be confused with the API's own reference: Scalar lives at http://localhost:3000/api/docs and is gated by the `DOCS_ENABLED` env key — see the [live API reference](/consumers/live-api-reference/).
