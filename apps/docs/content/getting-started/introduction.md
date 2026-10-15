---
title: Introduction
description: What this starter is, the philosophy behind it, and how these docs are organized.
order: 1
---

## What this starter is

A production-grade API starter: Hono on Bun, PostgreSQL via Drizzle, validated everywhere with Zod. It ships as a Bun-workspaces monorepo with:

- **A typed API** (`apps/api`) — OpenAPI 3.2 auto-derived from the same Zod schemas that validate requests, served with a Scalar UI at `/api/docs`.
- **An admin dashboard** (`apps/admin`) — Ant Design Pro + headless Refine. Registering a model on the backend produces admin CRUD routes, a metadata entry, and a sidebar menu item with list/form pages — zero frontend changes.
- **Shared Zod schemas** (`packages/schemas`) — the single source of truth for API shapes and admin field metadata, one file per model.
- **Generators** — `schemas:generate` scaffolds schema files and admin resource defs from Drizzle tables; `module:generate` scaffolds a full public API module. See [schemas:generate](/generators/schemas-generate/) and [module:generate](/generators/module-generate/).
- **Two auth realms** — JWT via Google sign-in for app users; org-restricted Google OIDC with session cookies for admins.
- **Background jobs** on pg-boss (queues live in Postgres — no extra broker), **Redis** as a cache/coordination layer (never a source of truth), and an **admin push notification console** (FCM send pipeline).
- **A third-party client pattern** — typed, retried, mockable, credential-safe outbound HTTP.

## Philosophy

Three rules shape every file:

1. **Conventions over configuration.** One response envelope, one list query contract, one error model, one place to read env. You learn them once and they hold everywhere — including generated code.
2. **Every file teaches a pattern.** This is a template others copy. Code stays small and readable; each worked example (`users`, `admins`, the example provider client, the welcome-email worker) exists to be imitated.
3. **Strict layering.** Routes handle HTTP only (Zod validation, envelopes). Services hold business logic and throw `AppError` subclasses — no Hono imports. Repos are Drizzle queries only. Everything is wired with factory functions taking deps as params — no DI container, trivially mockable.

Full detail in [Core Conventions](/architecture/conventions/).

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun | Also the test runner (`bun test`) |
| HTTP framework | Hono + @hono/zod-openapi | Routes are `createRoute()` defs; the OpenAPI spec derives from the runtime schemas |
| Database | PostgreSQL 16 + Drizzle ORM | postgres.js driver; migrations via drizzle-kit |
| Validation | Zod | At every boundary: requests, responses, env, job payloads, upstream responses |
| Background jobs | pg-boss | Postgres-backed queues; workers run in-process or as a separate process |
| Cache / coordination | ioredis | Cache-aside, shared rate-limit budget, locks, idempotency — degrades gracefully when down |
| Lint / format | Biome | No ESLint, no Prettier |
| API reference | Scalar | Interactive UI at `/api/docs`, gated by `DOCS_ENABLED` |

## How these docs are organized

| Section | What you'll find |
|---|---|
| Getting started | [Setup](/getting-started/setup/), [how a request flows](/getting-started/request-flow/), and the [command reference](/getting-started/commands/) |
| Architecture | [Monorepo layout](/architecture/monorepo-layout/), [core conventions](/architecture/conventions/), [env reference](/architecture/env-reference/), [security model](/architecture/security-model/) |
| Guides | Day-to-day recipes: [third-party clients](/guides/third-party-clients/), [background jobs](/guides/background-jobs/), [Redis](/guides/redis/), [notifications](/guides/notifications-system/), [testing](/guides/testing/) |
| Generators | The scaffolding tools: [schemas:generate](/generators/schemas-generate/) and [module:generate](/generators/module-generate/) |
| Admin | The admin realm: [auth](/admin/auth/), the [resource registry](/admin/resource-registry/), and the [frontend](/admin/frontend/) |
| Consumers | For client developers: [consuming the API](/consumers/consuming-the-api/), the [live API reference](/consumers/live-api-reference/) |
| Reference | Quick lookups: the [auth cheat sheet](/reference/auth-cheat-sheet/) and [troubleshooting](/reference/troubleshooting/) |
| Decisions | Why things are the way they are: [how it was built](/decisions/how-it-was-built/), [phase 10 admin integration](/decisions/phase-10-admin-integration/), [push notifications](/decisions/push-notifications/) |

Start with [Setup & First Run](/getting-started/setup/).
